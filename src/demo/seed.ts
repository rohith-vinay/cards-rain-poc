/**
 * Provision the portal demo: two partners, two businesses each, funded and card-ready.
 *
 * Run this BEFORE a demo, not during one. KYB and collateral crediting are the slow and
 * occasionally flaky parts - collateral has been observed sitting uncredited for over ten
 * minutes - so they belong well ahead of an audience.
 *
 *   npm run seed
 *   npm run seed -- --funding=10000000     # $100,000 per business
 */
import { config } from '../config.js';
import { RainApiError } from '../lib/errors.js';
import { pollUntil } from '../lib/poll.js';
import { PARTNERS } from '../partners/registry.js';
import { rain } from '../rain/client.js';
import { documentForm } from '../rain/document.js';
import { corporateApplication } from '../rain/fixtures.js';
import { TERMINAL_APPLICATION_STATUSES } from '../rain/types.js';
import { db, type SeededBusiness } from '../store/db.js';

/**
 * Deliberately plain labels: in a demo the hierarchy should read itself, so Business A1
 * is obviously one of Partner A's businesses without anyone having to explain it.
 */
const BUSINESS_NAMES: Record<string, string[]> = {
  'partner-a': ['Business A1', 'Business A2', 'Business A3'],
  'partner-b': ['Business B1', 'Business B2'],
  'partner-c': ['Business C1'],
};

/**
 * Cardholders are User 1..N so ownership reads straight off the card: Partner A,
 * Business A1, User 1. The "Approved" suffix stays on the last name because Rain drives
 * the employee's KYC outcome from it - without it they sit at `pending` and card
 * issuance fails with 403. It is stripped for display.
 */
const EMPLOYEES_PER_BUSINESS = 2;
const employees = () =>
  Array.from({ length: EMPLOYEES_PER_BUSINESS }, (_, i) => ({
    firstName: 'User',
    lastName: `${i + 1}Approved`,
  }));

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const fundingArg = process.argv.find((a) => a.startsWith('--funding='));
const FUNDING = fundingArg ? Number(fundingArg.split('=')[1]) : 5_000_000;

async function seedBusiness(
  partnerId: string,
  displayName: string,
  index: number,
): Promise<SeededBusiness | null> {
  const nonce = `${Date.now().toString(36)}${index}`;
  const label = `${displayName}`;
  process.stdout.write(`  ${label.padEnd(32)}`);

  try {
    // 1. KYB. The status token has to be in the COMPANY name for corporate applications.
    const application = corporateApplication({
      status: 'approved',
      companyName: `${displayName} Approved ${nonce.toUpperCase()}`,
      walletAddress: config.ownerAddress,
      nonce,
    });
    const company = await rain.createCompanyApplication(application);
    const uboIds = (company.ultimateBeneficialOwners ?? []).map((u) => u.id);

    // 2. Documents are required, not optional - without them KYB never resolves.
    await rain.uploadCompanyDocument(
      company.id,
      documentForm(
        { name: 'Certificate of incorporation', type: 'incorporationCert', countryCode: 'US' },
        'incorporation.png',
      ),
    );
    for (const uboId of uboIds) {
      await rain.uploadUboDocument(
        company.id,
        uboId,
        documentForm({ type: 'passport', side: 'front', countryCode: 'US' }, 'passport.png'),
      );
    }

    const decided = await pollUntil(
      () => rain.getCompanyApplication(company.id),
      (a) => TERMINAL_APPLICATION_STATUSES.includes(a.applicationStatus),
      { timeoutMs: 120_000, label: 'KYB' },
    );
    if (decided.applicationStatus !== 'approved') {
      throw new Error(`KYB landed on ${decided.applicationStatus}`);
    }

    // 3. Collateral. Rain assigns the contract on approval; we only read it.
    const contracts = await pollUntil(
      () => rain.getCompanyContracts(company.id),
      (list) => Array.isArray(list) && list.length > 0 && Boolean(list[0]?.id),
      { timeoutMs: 180_000, label: 'contract' },
    );
    const contract = contracts.find((c) => c.chainId === config.chainId) ?? contracts[0]!;

    await rain.simulateFundCollateral(contract.id, FUNDING);

    // Do not declare the business ready until it can actually authorise.
    await pollUntil(
      () => rain.getCompanyBalances(company.id),
      (b) => (b?.spendingPower ?? 0) > 0,
      { timeoutMs: 300_000, intervalMs: 3_000, maxIntervalMs: 10_000, label: 'spending power' },
    );

    // 4. Cardholders. No cards - issuing one live is the demo's opening beat.
    const userIds: string[] = [];
    for (const [i, employee] of employees().entries()) {
      const user = await rain.createCompanyUser(company.id, {
        ...employee,
        email: `user${i + 1}@${nonce}.example.com`,
        externalId: `${nonce}-user${i + 1}`,
      });
      userIds.push(user.id);
    }

    const business: SeededBusiness = {
      companyId: company.id,
      name: displayName,
      partnerId,
      contractId: contract.id,
      userIds,
      cardIds: [],
      fundedCents: FUNDING,
    };
    db.upsertBusiness(business);
    console.log(`ready   ${money(FUNDING)}  ${userIds.length} cardholders`);
    return business;
  } catch (err) {
    const detail =
      err instanceof RainApiError ? `${err.message}: ${JSON.stringify(err.body)}` :
      err instanceof Error ? err.message : String(err);
    console.log(`FAILED\n      ${detail}`);
    return null;
  }
}

console.log('\nSeeding portal demo data');
console.log('========================\n');

let ok = 0;
let failed = 0;
let index = 0;

for (const partner of PARTNERS) {
  console.log(`${partner.name}`);
  for (const name of BUSINESS_NAMES[partner.id] ?? []) {
    const result = await seedBusiness(partner.id, name, index++);
    result ? ok++ : failed++;
  }
  console.log('');
}

console.log('------------------------');
console.log(`ready ${ok}, failed ${failed}`);
if (ok === 0) {
  console.error('\nNothing was provisioned. The portal will have no data.\n');
  process.exit(1);
}
if (failed > 0) {
  console.warn('\nSome businesses failed. The portal will still run with the ones that worked.');
  console.warn('Collateral crediting is the usual culprit - re-run to add the missing ones.\n');
} else {
  console.log('\nAll businesses ready. Start the server and open http://localhost:' + config.port + '\n');
}
