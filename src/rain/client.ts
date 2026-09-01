import { config } from '../config.js';
import { RainApiError } from '../lib/errors.js';
import { sleep } from '../lib/poll.js';
import type {
  Balances,
  CompanyApplicationStatus,
  CreateCardBody,
  CreateCompanyApplicationBody,
  CreateCompanyUserBody,
  DisputeType,
  IssuingCard,
  IssuingCompany,
  IssuingContract,
  IssuingDispute,
  IssuingTransaction,
  IssuingUser,
  PageParams,
  SimulateAuthorizeBody,
  SimulateTransactionResponse,
  UpdateCardBody,
} from './types.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Multipart bodies bypass JSON encoding. */
  form?: FormData;
  headers?: Record<string, string>;
  /** GETs are retried on 5xx/429; writes are not, to avoid duplicate side effects. */
  retry?: boolean;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/**
 * One HTTP client for the whole Rain API.
 *
 * Deliberately not the official SDK: the SDK generates 60 of the API's 130 operations and
 * pins its base URL to `/v1/issuing`, so it cannot reach `/v1/simulate` at all - which is
 * every endpoint that moves money in sandbox. One client over both prefixes keeps the
 * call sites uniform and removes a dependency on an alpha package.
 */
export class RainClient {
  constructor(
    private readonly apiKey = config.apiKey,
    private readonly baseUrl = config.baseUrl,
  ) {}

  private async request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      'Api-Key': this.apiKey,
      Accept: 'application/json',
      ...opts.headers,
    };

    let body: string | FormData | undefined;
    if (opts.form) {
      body = opts.form; // fetch sets the multipart boundary itself
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const retryable = opts.retry ?? method === 'GET';
    const maxAttempts = retryable ? 3 : 1;
    let attempt = 0;

    for (;;) {
      attempt++;
      const res = await fetch(url, { method, headers, body });

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        const ct = res.headers.get('content-type') ?? '';
        return (ct.includes('application/json') ? JSON.parse(text) : text) as T;
      }

      if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * attempt);
        continue;
      }

      let parsed: unknown;
      const raw = await res.text();
      try {
        parsed = raw ? JSON.parse(raw) : raw;
      } catch {
        parsed = raw;
      }
      throw new RainApiError(method, path, res.status, parsed);
    }
  }

  // ---------------------------------------------------------------- onboarding (KYB)

  createCompanyApplication(body: CreateCompanyApplicationBody) {
    return this.request<IssuingCompany>('POST', '/issuing/applications/company', { body });
  }

  getCompanyApplication(companyId: string) {
    return this.request<CompanyApplicationStatus>(
      'GET',
      `/issuing/applications/company/${companyId}`,
    );
  }

  updateCompanyApplication(companyId: string, body: Record<string, unknown>) {
    return this.request<IssuingCompany>('PATCH', `/issuing/applications/company/${companyId}`, {
      body,
    });
  }

  addUbo(companyId: string, body: Record<string, unknown>) {
    return this.request<IssuingCompany>('POST', `/issuing/applications/company/${companyId}/ubo`, {
      body,
    });
  }

  updateUbo(companyId: string, uboId: string, body: Record<string, unknown>) {
    return this.request<IssuingCompany>(
      'PATCH',
      `/issuing/applications/company/${companyId}/ubo/${uboId}`,
      { body },
    );
  }

  /** KYB document upload. Rain caps uploads at 20MB. */
  uploadCompanyDocument(companyId: string, form: FormData) {
    return this.request<void>('PUT', `/issuing/applications/company/${companyId}/document`, {
      form,
    });
  }

  uploadUboDocument(companyId: string, uboId: string, form: FormData) {
    return this.request<void>(
      'PUT',
      `/issuing/applications/company/${companyId}/ubo/${uboId}/document`,
      { form },
    );
  }

  // ---------------------------------------------------------------- companies

  listCompanies(page: PageParams = {}) {
    return this.request<IssuingCompany[]>('GET', '/issuing/companies', { query: { ...page } });
  }

  getCompany(companyId: string) {
    return this.request<IssuingCompany>('GET', `/issuing/companies/${companyId}`);
  }

  updateCompany(companyId: string, body: Record<string, unknown>) {
    return this.request<IssuingCompany>('PATCH', `/issuing/companies/${companyId}`, { body });
  }

  getCompanyBalances(companyId: string) {
    return this.request<Balances>('GET', `/issuing/companies/${companyId}/balances`);
  }

  /** Charge the company a custom fee. Amount in cents. */
  chargeCompany(companyId: string, body: { amount: number; description: string }) {
    return this.request<{ id: string; createdAt: string }>(
      'POST',
      `/issuing/companies/${companyId}/charges`,
      { body },
    );
  }

  // ---------------------------------------------------------------- collateral contracts

  /**
   * Corporate contracts require an owner address as well as a chain, unlike consumer
   * contracts. Returns 202 - the deploy finishes asynchronously and lands as contract.created.
   */
  createCompanyContract(companyId: string, body: { chainId: number; ownerAddress: string }) {
    return this.request<void>('POST', `/issuing/companies/${companyId}/contracts`, { body });
  }

  getCompanyContracts(companyId: string) {
    return this.request<IssuingContract[]>('GET', `/issuing/companies/${companyId}/contracts`);
  }

  // ---------------------------------------------------------------- cardholders

  createCompanyUser(companyId: string, body: CreateCompanyUserBody) {
    return this.request<IssuingUser>('POST', `/issuing/companies/${companyId}/users`, { body });
  }

  listUsers(query: { companyId?: string; email?: string } & PageParams = {}) {
    return this.request<IssuingUser[]>('GET', '/issuing/users', { query: { ...query } });
  }

  getUser(userId: string) {
    return this.request<IssuingUser>('GET', `/issuing/users/${userId}`);
  }

  updateUser(userId: string, body: Record<string, unknown>) {
    return this.request<IssuingUser>('PATCH', `/issuing/users/${userId}`, { body });
  }

  deleteUser(userId: string) {
    return this.request<void>('DELETE', `/issuing/users/${userId}`);
  }

  getUserBalances(userId: string) {
    return this.request<Balances>('GET', `/issuing/users/${userId}/balances`);
  }

  // ---------------------------------------------------------------- cards

  createCard(userId: string, body: CreateCardBody) {
    return this.request<IssuingCard>('POST', `/issuing/users/${userId}/cards`, { body });
  }

  listCards(query: { companyId?: string; userId?: string; status?: string } & PageParams = {}) {
    return this.request<IssuingCard[]>('GET', '/issuing/cards', { query: { ...query } });
  }

  getCard(cardId: string) {
    return this.request<IssuingCard>('GET', `/issuing/cards/${cardId}`);
  }

  updateCard(cardId: string, body: UpdateCardBody) {
    return this.request<IssuingCard>('PATCH', `/issuing/cards/${cardId}`, { body });
  }

  /**
   * Requires a SessionId header holding an encrypted session id the caller generates.
   * Returns ciphertext + IV for the PAN and CVC; decryption happens on our side.
   */
  getCardSecrets(cardId: string, sessionId: string) {
    return this.request<{
      encryptedPan: { iv: string; data: string };
      encryptedCvc: { iv: string; data: string };
    }>('GET', `/issuing/cards/${cardId}/secrets`, { headers: { SessionId: sessionId } });
  }

  // ---------------------------------------------------------------- transactions

  listTransactions(
    query: {
      companyId?: string;
      userId?: string;
      cardId?: string;
      authorizedAfter?: string;
      authorizedBefore?: string;
    } & PageParams = {},
  ) {
    return this.request<IssuingTransaction[]>('GET', '/issuing/transactions', {
      query: { ...query },
    });
  }

  getTransaction(transactionId: string) {
    return this.request<IssuingTransaction>('GET', `/issuing/transactions/${transactionId}`);
  }

  updateTransaction(transactionId: string, body: { memo?: string }) {
    return this.request<void>('PATCH', `/issuing/transactions/${transactionId}`, { body });
  }

  // ---------------------------------------------------------------- disputes

  createDispute(
    transactionId: string,
    body: { disputeType?: DisputeType; textEvidence?: string; disputeAmount?: number },
  ) {
    return this.request<IssuingDispute>('POST', `/issuing/transactions/${transactionId}/disputes`, {
      body,
    });
  }

  listDisputes(query: { companyId?: string; userId?: string; status?: string } & PageParams = {}) {
    return this.request<IssuingDispute[]>('GET', '/issuing/disputes', { query: { ...query } });
  }

  getDispute(disputeId: string) {
    return this.request<IssuingDispute>('GET', `/issuing/disputes/${disputeId}`);
  }

  updateDispute(disputeId: string, body: { status?: 'canceled'; textEvidence?: string }) {
    return this.request<void>('PATCH', `/issuing/disputes/${disputeId}`, { body });
  }

  // ---------------------------------------------------------------- webhooks admin

  listWebhookDeliveries(query: { resourceType?: string; resourceId?: string } & PageParams = {}) {
    return this.request<Array<Record<string, unknown>>>('GET', '/issuing/webhooks', {
      query: { ...query },
    });
  }

  getWebhookConfiguration() {
    return this.request<Record<string, { version?: string }>>(
      'GET',
      '/issuing/webhooks/configuration',
    );
  }

  patchWebhookConfiguration(body: Record<string, { version?: string } | null>) {
    return this.request<Record<string, { version?: string }>>(
      'PATCH',
      '/issuing/webhooks/configuration',
      { body },
    );
  }

  // ---------------------------------------------------------------- simulator (sandbox only)

  simulateAuthorize(body: SimulateAuthorizeBody) {
    return this.request<SimulateTransactionResponse>('POST', '/simulate/transactions/authorize', {
      body,
    });
  }

  simulateAuthorizeUpdate(transactionId: string, amount: number) {
    return this.request<SimulateTransactionResponse>(
      'PATCH',
      `/simulate/transactions/${transactionId}/authorize`,
      { body: { amount } },
    );
  }

  /**
   * `amount` is REQUIRED despite the OpenAPI spec marking the whole body optional -
   * omitting it fails with 400 "body must have required property 'amount'".
   * Pass the current authorized amount to settle in full.
   */
  simulateSettle(transactionId: string, amount: number) {
    return this.request<SimulateTransactionResponse>(
      'POST',
      `/simulate/transactions/${transactionId}/settle`,
      { body: { amount } },
    );
  }

  /** Unlike settle and refund, `newAmount` really is optional; omit for a full reversal. */
  simulateReverse(transactionId: string, newAmount?: number) {
    return this.request<SimulateTransactionResponse>(
      'POST',
      `/simulate/transactions/${transactionId}/reverse`,
      { body: newAmount === undefined ? {} : { newAmount } },
    );
  }

  /** `amount` is REQUIRED here too, for the same reason as settle. */
  simulateRefund(transactionId: string, amount: number) {
    return this.request<SimulateTransactionResponse>(
      'POST',
      `/simulate/transactions/${transactionId}/refund`,
      { body: { amount } },
    );
  }

  /** Only `rusd` is supported; amount is in cents. */
  simulateFundCollateral(contractId: string, amount: number) {
    return this.request<{ transactionId: string }>('POST', '/simulate/collateral/fund', {
      body: { contractId, currency: 'rusd', amount },
    });
  }
}

export const rain = new RainClient();
