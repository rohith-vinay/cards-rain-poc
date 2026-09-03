import { config } from '../config.js';
import { RainApiError } from '../lib/errors.js';
import { pollUntil, sleep } from '../lib/poll.js';
import { rain } from '../rain/client.js';
import { documentForm } from '../rain/document.js';
import { cardholders, corporateApplication, MERCHANTS } from '../rain/fixtures.js';
import { TERMINAL_APPLICATION_STATUSES } from '../rain/types.js';
import { db } from '../store/db.js';

export interface StepResult {
  step: string;
  status: 'ok' | 'failed' | 'skipped';
  detail?: string;
  data?: unknown;
  at: string;
}

export interface DemoOptions {
  /** Collateral to fund, in cents. Default $50,000. */
  fundingAmount?: number;
  /** Skip onboarding and reuse the company from a previous run. */
  reuseCompanyId?: string;
  /** Emit progress as it happens (the CLI prints these). */
  onStep?: (result: StepResult) => void;
}

export interface DemoSummary {
  companyId: string | null;
  contractId: string | null;
  userIds: string[];
  cardIds: string[];
  steps: StepResult[];
  balances?: unknown;
  failed: boolean;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

/**
 * The whole corporate card program, start to finish, against Rain's sandbox.
 *
 * Written as a linear script on purpose: it doubles as the narration for a demo, and
 * every step records what it did so the result can be replayed on screen afterwards.
 */
export async function runDemo(opts: DemoOptions = {}): Promise<DemoSummary> {
  const steps: StepResult[] = [];
  const fundingAmount = opts.fundingAmount ?? 5_000_000; // $50,000
  const nonce = Date.now().toString(36);

  let companyId = opts.reuseCompanyId ?? null;
  let contractId: string | null = null;
  const userIds: string[] = [];
  const cardIds: string[] = [];
  let uboIds: string[] = [];
  let failed = false;

  db.resetDemoLog();

  async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (failed) {
      record(name, 'skipped', 'an earlier step failed');
      return undefined;
    }
    try {
      const data = await fn();
      record(name, 'ok', undefined, data);
      return data;
    } catch (err) {
      failed = true;
      record(name, 'failed', describe(err));
      return undefined;
    }
  }

  function record(step: string, status: StepResult['status'], detail?: string, data?: unknown) {
    const result: StepResult = { step, status, detail, data, at: new Date().toISOString() };
    steps.push(result);
    db.appendDemoStep({ step, status, detail, at: result.at });
    opts.onStep?.(result);
  }

  // 1 -------------------------------------------------------------- KYB
  if (!companyId) {
    const company = await step('Submit corporate application (KYB)', async () => {
      const created = await rain.createCompanyApplication(
        corporateApplication({ status: 'approved', walletAddress: config.ownerAddress, nonce }),
      );
      db.update({ companyId: created.id, companyName: created.name });
      uboIds = (created.ultimateBeneficialOwners ?? []).map((u) => u.id);
      return {
        companyId: created.id,
        name: created.name,
        applicationStatus: created.applicationStatus,
        ubos: uboIds.length,
      };
    });
    companyId = company?.companyId ?? null;
  } else {
    record('Submit corporate application (KYB)', 'skipped', `reusing company ${companyId}`);
  }

  // Documents are a REQUIRED step, not an optional one. Without them the application
  // sits at needsVerification forever: nothing has been submitted for review, so the
  // sandbox status fixtures never get a chance to resolve it.
  await step('Upload KYB and UBO documents', async () => {
    if (uboIds.length === 0) {
      const app = await rain.getCompanyApplication(companyId!);
      uboIds = app.ultimateBeneficialOwners.map((u) => u.id);
    }

    await rain.uploadCompanyDocument(
      companyId!,
      documentForm(
        { name: 'Certificate of incorporation', type: 'incorporationCert', countryCode: 'US' },
        'incorporation-certificate.png',
      ),
    );

    for (const uboId of uboIds) {
      await rain.uploadUboDocument(
        companyId!,
        uboId,
        documentForm({ type: 'passport', side: 'front', countryCode: 'US' }, 'passport.png'),
      );
    }

    return { companyDocuments: 1, uboDocuments: uboIds.length };
  });

  await step('Wait for KYB decision', async () => {
    const app = await pollUntil(
      () => rain.getCompanyApplication(companyId!),
      (a) => TERMINAL_APPLICATION_STATUSES.includes(a.applicationStatus),
      { timeoutMs: 120_000, label: 'company KYB' },
    );
    if (app.applicationStatus !== 'approved') {
      throw new Error(
        `Company landed on "${app.applicationStatus}"${app.applicationReason ? ` (${app.applicationReason})` : ''}. ` +
          'Cards can only be issued against an approved company.',
      );
    }
    return {
      applicationStatus: app.applicationStatus,
      ubos: app.ultimateBeneficialOwners.map((u) => ({
        id: u.id,
        status: u.applicationStatus,
      })),
    };
  });

  // 2 -------------------------------------------------------------- collateral contract
  //
  // Rain assigns a collateral contract automatically when a company is approved, so this
  // usually has nothing to do. Creating one anyway returns 409 "already has a contract on
  // this chain", which is a success for our purposes, not a failure.
  await step('Ensure a company collateral contract exists', async () => {
    const existing = await rain.getCompanyContracts(companyId!).catch(() => []);
    if (Array.isArray(existing) && existing.length > 0) {
      return {
        source: 'assigned automatically on approval',
        contracts: existing.map((c) => ({ id: c.id, chainId: c.chainId })),
      };
    }

    try {
      await rain.createCompanyContract(companyId!, {
        chainId: config.chainId,
        ownerAddress: config.ownerAddress,
      });
      return { source: 'created', chainId: config.chainId, ownerAddress: config.ownerAddress };
    } catch (err) {
      if (err instanceof RainApiError && err.status === 409) {
        return { source: 'already existed (409)', chainId: config.chainId };
      }
      throw err;
    }
  });

  await step('Read the collateral contract', async () => {
    const contracts = await pollUntil(
      () => rain.getCompanyContracts(companyId!),
      (list) => Array.isArray(list) && list.length > 0 && Boolean(list[0]?.id),
      { timeoutMs: 180_000, label: 'collateral contract to become readable' },
    );
    // Prefer a contract on the configured chain when the company has several.
    const contract = contracts.find((c) => c.chainId === config.chainId) ?? contracts[0]!;
    contractId = contract.id;
    db.update({ contractId: contract.id });
    return {
      contractId: contract.id,
      chainId: contract.chainId,
      proxyAddress: contract.proxyAddress,
      chainsAvailable: contracts.map((c) => c.chainId),
    };
  });

  // 3 -------------------------------------------------------------- funding
  await step(`Fund collateral with ${money(fundingAmount)} (simulated)`, async () => {
    const result = await rain.simulateFundCollateral(contractId!, fundingAmount);
    return result;
  });

  // Funds land on the contract quickly, but Rain recomputes the credit limit on its own
  // schedule - observed anywhere from under a minute to several. Wait generously, and if
  // it still has not landed, say which of the two stages actually stalled.
  await step('Wait for spending power to appear', async () => {
    try {
      const balances = await pollUntil(
        () => rain.getCompanyBalances(companyId!),
        (b) => (b?.spendingPower ?? 0) > 0,
        {
          timeoutMs: 300_000,
          intervalMs: 3_000,
          maxIntervalMs: 10_000,
          label: 'collateral to credit spending power',
        },
      );
      return { ...balances, readable: money(balances.spendingPower) };
    } catch (err) {
      const contracts = await rain.getCompanyContracts(companyId!).catch(() => []);
      const funded = contracts
        .flatMap((c) => c.tokens ?? [])
        .filter((t) => Number(t.balance ?? 0) > 0);
      if (funded.length > 0) {
        throw new Error(
          `Collateral is on the contract (${funded
            .map((t) => `${t.balance} @ ${t.address.slice(0, 10)}...`)
            .join(', ')}) but Rain has not recomputed the credit limit yet. ` +
            'This is a Rain-side delay, not a failed deposit - re-run with ' +
            `--company=${companyId} in a few minutes and it will pick up from here.`,
        );
      }
      throw err;
    }
  });

  // 4 -------------------------------------------------------------- cardholders
  await step('Add two employees as cardholders', async () => {
    const created = [];
    for (const employee of cardholders(nonce)) {
      const user = await rain.createCompanyUser(companyId!, employee);
      userIds.push(user.id);
      db.push('userIds', user.id);
      created.push({ id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email });
    }
    return created;
  });

  // 5 -------------------------------------------------------------- issuance
  await step('Issue a virtual card to each employee', async () => {
    const issued = [];
    const limits = [
      { amount: 250_000, frequency: 'per30DayPeriod' as const }, // $2,500/mo
      { amount: 100_000, frequency: 'per30DayPeriod' as const }, // $1,000/mo
    ];
    for (const [i, userId] of userIds.entries()) {
      const card = await rain.createCard(userId, {
        type: 'virtual',
        status: 'active',
        limit: limits[i] ?? limits[0],
      });
      cardIds.push(card.id);
      db.push('cardIds', card.id);
      issued.push({
        cardId: card.id,
        userId,
        last4: card.last4,
        status: card.status,
        limit: card.limit,
      });
    }
    return issued;
  });

  // 6 -------------------------------------------------------------- configuration
  await step('Raise the first card\'s monthly limit to $5,000', async () => {
    await rain.updateCard(cardIds[0]!, {
      limit: { amount: 500_000, frequency: 'per30DayPeriod' },
    });
    // The PATCH response can echo the previous limit, so read the card back for the
    // value we actually report.
    const card = await rain.getCard(cardIds[0]!);
    return { cardId: card.id, limit: card.limit, readable: money(card.limit?.amount ?? 0) };
  });

  // 7 -------------------------------------------------------------- spend to settlement
  const merchant = MERCHANTS[2]!; // freight, a plausible corporate charge
  const authorized = await step(
    `Authorize ${money(merchant.amount)} at ${merchant.merchantName}`,
    async () => {
      const result = await rain.simulateAuthorize({
        cardId: cardIds[0]!,
        amount: merchant.amount,
        currency: 'USD',
        merchantName: merchant.merchantName,
        merchantCategoryCode: merchant.merchantCategoryCode,
      });
      if (result.status !== 'authorized') {
        throw new Error(
          `Expected an approval but got "${result.status}"` +
            (result.declinedReason ? ` (${result.declinedReason})` : '') +
            '. Check that collateral funding actually landed.',
        );
      }
      db.push('transactionIds', result.transactionId);
      return result;
    },
  );

  await step('Show the hold against company spending power', async () => {
    const balances = await rain.getCompanyBalances(companyId!);
    return { pendingCharges: money(balances.pendingCharges), spendingPower: money(balances.spendingPower) };
  });

  const bumped = merchant.amount + 4_500;
  await step(`Merchant revises the amount to ${money(bumped)}`, () =>
    rain.simulateAuthorizeUpdate(authorized!.transactionId, bumped),
  );

  // Settle for the revised amount. Rain requires an explicit amount here.
  await step(`Settle for ${money(bumped)}`, () =>
    rain.simulateSettle(authorized!.transactionId, bumped),
  );

  await step('Show the charge posted', async () => {
    const balances = await rain.getCompanyBalances(companyId!);
    return {
      pendingCharges: money(balances.pendingCharges),
      postedCharges: money(balances.postedCharges),
      balanceDue: money(balances.balanceDue),
    };
  });

  // 8 -------------------------------------------------------------- controls that bite
  await step('Lock the second card', () =>
    rain.updateCard(cardIds[1]!, { status: 'locked' }).then((c) => ({
      cardId: c.id,
      status: c.status,
    })),
  );

  // A locked card cannot even be presented to the simulator: it validates card status
  // first and rejects with 400 "Card is not active" instead of returning a decline.
  // That rejection IS the proof the lock bites, so it is the success condition here.
  await step('Prove the locked card cannot transact', async () => {
    try {
      const result = await rain.simulateAuthorize({
        cardId: cardIds[1]!,
        amount: MERCHANTS[3]!.amount,
        currency: 'USD',
        merchantName: MERCHANTS[3]!.merchantName,
        merchantCategoryCode: MERCHANTS[3]!.merchantCategoryCode,
      });
      throw new Error(
        `A locked card should not have authorized, but got "${result.status}" ` +
          `(transaction ${result.transactionId}).`,
      );
    } catch (err) {
      if (err instanceof RainApiError && err.status === 400) {
        return { blocked: true, rainSaid: (err.body as { message?: string })?.message };
      }
      throw err;
    }
  });

  await step('Unlock the second card', () =>
    rain.updateCard(cardIds[1]!, { status: 'active' }).then((c) => ({
      cardId: c.id,
      status: c.status,
    })),
  );

  // Decline reasons are simulated against an ACTIVE card - they model what the network
  // would have said, rather than a card the platform has already disabled.
  await step('Simulate a decline at the terminal (blocked category)', async () => {
    const result = await rain.simulateAuthorize({
      cardId: cardIds[1]!,
      amount: MERCHANTS[3]!.amount,
      currency: 'USD',
      merchantName: MERCHANTS[3]!.merchantName,
      merchantCategoryCode: MERCHANTS[3]!.merchantCategoryCode,
      declineReason: 'blocked_mcc',
    });
    if (result.status !== 'declined') {
      throw new Error(`Expected a decline, got "${result.status}".`);
    }
    return result;
  });

  // 9 -------------------------------------------------------------- reversal
  const reversible = await step('Authorize a charge that the merchant then cancels', async () => {
    const result = await rain.simulateAuthorize({
      cardId: cardIds[1]!,
      amount: MERCHANTS[0]!.amount,
      currency: 'USD',
      merchantName: MERCHANTS[0]!.merchantName,
      merchantCategoryCode: MERCHANTS[0]!.merchantCategoryCode,
    });
    db.push('transactionIds', result.transactionId);
    return result;
  });

  await step('Reverse it, releasing the hold with nothing posted', () =>
    rain.simulateReverse(reversible!.transactionId),
  );

  // 10 ------------------------------------------------------------- refund and dispute
  await step('Refund $100.00 of the settled charge', () =>
    rain.simulateRefund(authorized!.transactionId, 10_000),
  );

  await step('Open a dispute on the settled charge', async () => {
    // Disputes need the transaction to be posted; settlement is not instant.
    await pollUntil(
      () => rain.getTransaction(authorized!.transactionId),
      (tx) => Boolean((tx as { spend?: { postedAt?: string } }).spend?.postedAt),
      { timeoutMs: 60_000, label: 'transaction to post' },
    ).catch(() => undefined);

    const dispute = await rain.createDispute(authorized!.transactionId, {
      disputeType: 'merchandiseIssue',
      textEvidence: 'Freight delivered damaged; carrier acknowledged but has not credited.',
      disputeAmount: 25_000,
    });
    db.push('disputeIds', dispute.id);
    return { disputeId: dispute.id, status: dispute.status, amount: money(dispute.disputeAmount) };
  });

  // 11 ------------------------------------------------------------- wrap up
  let balances: unknown;
  try {
    // Give trailing webhooks a beat to land before the summary is read.
    await sleep(1_500);
    balances = await rain.getCompanyBalances(companyId!);
  } catch {
    balances = undefined;
  }

  return { companyId, contractId, userIds, cardIds, steps, balances, failed };
}

function describe(err: unknown): string {
  if (err instanceof RainApiError) {
    if (err.isSimulatorUnavailable) {
      return (
        `${err.message}. The /simulate endpoints 404 both in production and when the tenant ` +
        'is not enabled for them - ask Rain to switch simulation on for this sandbox tenant.'
      );
    }
    return `${err.message}: ${JSON.stringify(err.body)}`;
  }
  return err instanceof Error ? err.message : String(err);
}
