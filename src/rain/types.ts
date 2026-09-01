/**
 * Types transcribed from Rain's Issuing API OpenAPI spec v1.3.0.
 * Only the parts this POC touches - the full spec is 130 operations.
 */

export type CountryCode = string; // ISO-3166 alpha-2

export interface PhysicalAddress {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: CountryCode;
}

/**
 * Note: `tosNotAccepted`, `notStarted` and `exempt` are documented in
 * docs/application-states but are missing from the OpenAPI enum. Handle them anyway -
 * a real integration will see them.
 */
export type ApplicationStatus =
  | 'approved'
  | 'pending'
  | 'needsInformation'
  | 'needsVerification'
  | 'manualReview'
  | 'denied'
  | 'locked'
  | 'canceled'
  | 'tosNotAccepted'
  | 'notStarted'
  | 'exempt';

/** Statuses that will never change again without us doing something. */
export const TERMINAL_APPLICATION_STATUSES: ApplicationStatus[] = [
  'approved',
  'denied',
  'canceled',
  'locked',
  'exempt',
];

/** Statuses that mean Rain is waiting on us to supply more. */
export const ACTIONABLE_APPLICATION_STATUSES: ApplicationStatus[] = [
  'needsInformation',
  'needsVerification',
  'tosNotAccepted',
];

export interface ApplicationEnvelope {
  applicationStatus: ApplicationStatus;
  applicationCompletionLink?: { url: string; params?: { userId?: string } };
  applicationReason?: string;
}

export interface ApplicationPerson {
  id?: string;
  firstName: string;
  lastName: string;
  birthDate: string; // YYYY-MM-DD
  nationalId: string;
  countryOfIssue: CountryCode;
  email: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
  address: PhysicalAddress;
}

export interface CompanyEntity {
  name: string;
  type?: string;
  description: string;
  industry: string;
  registrationNumber: string;
  taxId: string;
  website: string;
  expectedSpend?: string;
}

export interface CreateCompanyApplicationBody {
  initialUser: ApplicationPerson & {
    role?: string;
    /** Required for Rain-managed: this wallet becomes an owner on the company contract. */
    walletAddress?: string;
    solanaAddress?: string;
    ipAddress: string;
    isTermsOfServiceAccepted?: true;
  };
  name: string;
  address: PhysicalAddress;
  entity: CompanyEntity;
  representatives: ApplicationPerson[];
  ultimateBeneficialOwners: ApplicationPerson[];
  externalId?: string;
  sourceKey?: string;
}

export interface IssuingCompany extends ApplicationEnvelope {
  id: string;
  externalId?: string;
  name: string;
  address: PhysicalAddress;
  ultimateBeneficialOwners?: Array<{ id: string } & ApplicationEnvelope>;
}

export interface CompanyApplicationStatus extends ApplicationEnvelope {
  id: string;
  externalId?: string;
  ultimateBeneficialOwners: Array<
    {
      id: string;
      firstName?: string;
      lastName?: string;
      email?: string;
    } & ApplicationEnvelope
  >;
}

export interface IssuingUser extends ApplicationEnvelope {
  id: string;
  companyId?: string;
  externalId?: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  address?: PhysicalAddress;
  phoneCountryCode?: string;
  phoneNumber?: string;
  walletAddress?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateCompanyUserBody {
  firstName: string;
  lastName: string;
  email: string;
  birthDate?: string;
  walletAddress?: string;
  address?: PhysicalAddress;
  phoneCountryCode?: string;
  phoneNumber?: string;
  externalId?: string;
}

export type CardStatus = 'notActivated' | 'active' | 'locked' | 'canceled';
export type CardType = 'physical' | 'virtual';

export type CardLimitFrequency =
  | 'per24HourPeriod'
  | 'per7DayPeriod'
  | 'per30DayPeriod'
  | 'perYearPeriod'
  | 'allTime'
  | 'perAuthorization';

export interface CardLimit {
  /** In cents. */
  amount: number;
  frequency: CardLimitFrequency;
}

export interface IssuingCard {
  id: string;
  companyId: string;
  userId: string;
  type: CardType;
  status: CardStatus;
  limit?: CardLimit;
  last4: string;
  expirationMonth: string;
  expirationYear: string;
  configuration?: { scheme?: string; rail?: string; currency?: string };
  tokenWallets?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateCardBody {
  type: CardType;
  status?: CardStatus;
  limit?: CardLimit;
  configuration?: {
    displayName?: string;
    productId?: string;
    productRef?: string;
    virtualCardArt?: string;
  };
  billing?: PhysicalAddress;
  shipping?: Record<string, unknown>;
}

export interface UpdateCardBody {
  status?: CardStatus;
  limit?: CardLimit;
  billing?: PhysicalAddress;
  configuration?: { virtualCardArt?: string };
}

export interface Balances {
  creditLimit: number;
  pendingCharges: number;
  postedCharges: number;
  balanceDue: number;
  spendingPower: number;
  currency?: 'usd' | 'eur';
}

export interface IssuingContract {
  id: string;
  chainId: number;
  controllerAddress: string;
  proxyAddress: string;
  depositAddress?: string;
  adminAddresses?: string[];
  contractVersion: number;
  tokens: Array<{ address: string; balance?: string }>;
}

export type TransactionType =
  | 'spend'
  | 'collateral'
  | 'payment'
  | 'fee'
  | 'adjustment'
  | 'transfer'
  | 'verification';

export interface SpendTransaction {
  id: string;
  type: 'spend';
  spend: {
    amount: number;
    currency: string;
    authorizedAmount?: number;
    memo?: string;
    merchantName: string;
    merchantCategory: string;
    merchantCategoryCode: string;
    cardId: string;
    cardType: CardType;
    companyId?: string;
    userId: string;
    userFirstName: string;
    userLastName?: string;
    userEmail: string;
    status: 'pending' | 'reversed' | 'declined' | 'completed';
    declinedReason?: string;
    authorizedAt: string;
    postedAt?: string;
  };
}

/** Other transaction variants are passed through untyped; only spend drives the demo. */
export type IssuingTransaction = SpendTransaction | ({ id: string; type: TransactionType } & Record<string, unknown>);

export type DisputeType =
  | 'fraud'
  | 'creditNotProcessed'
  | 'serviceNotReceived'
  | 'merchandiseIssue'
  | 'other';

export interface IssuingDispute {
  id: string;
  transactionId: string;
  status: 'pending' | 'inReview' | 'accepted' | 'rejected' | 'canceled' | 'resolvedByMerchant';
  disputeType?: DisputeType;
  textEvidence?: string;
  disputeAmount: number;
  currency?: string;
  createdAt: string;
  resolvedAt?: string;
}

/** Every decline the simulator can be asked to produce. */
export const DECLINE_REASONS = [
  'account_credit_limit_exceeded',
  'card_locked',
  'card_canceled',
  'card_not_activated',
  'blocked_mcc',
  'blocked_merchant',
  'balance_inquiry_not_permitted',
  'expiry_mismatch',
  'cvv_mismatch',
  'invalid_pin',
  'restricted_country',
] as const;

export type DeclineReason = (typeof DECLINE_REASONS)[number];

export interface SimulateAuthorizeBody {
  cardId: string;
  /** In cents, merchant currency. */
  amount: number;
  currency: string;
  merchantName: string;
  merchantCategoryCode: string;
  declineReason?: DeclineReason;
}

export interface SimulateTransactionResponse {
  transactionId: string;
  status: 'authorized' | 'declined' | 'settled';
  declinedReason?: string;
  /**
   * The spec documents `SETTLEMENT` / `REFUND`, but the sandbox returns lowercase
   * snake_case and a value the spec does not list at all. Observed:
   * `settlement`, `refund`, `authorization_reversal`. Compare case-insensitively.
   */
  completionReason?: string;
}

export interface PageParams {
  cursor?: string;
  /** Rain caps this at 100. */
  limit?: number;
}
