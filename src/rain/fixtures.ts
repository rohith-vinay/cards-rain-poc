import { config } from '../config.js';
import type {
  ApplicationPerson,
  ApplicationStatus,
  CreateCompanyApplicationBody,
  PhysicalAddress,
} from './types.js';

/**
 * Sandbox status fixtures.
 *
 * Rain's sandbox drives an application to a chosen status when a name field contains
 * that status string, case-insensitively. Whitespace breaks the match, so
 * "NeedsVerification" works and "Needs Verification" does not.
 *
 * WHICH field differs by program type, and the docs only describe the consumer case:
 *   - Consumer / individual users: the person's LAST NAME.
 *   - Corporate applications:      the COMPANY NAME.
 *
 * Verified against the sandbox: a corporate application whose people are all named
 * "TestApproved" stays at needsVerification, while one whose company name contains
 * "Approved" is approved immediately.
 *
 * This is how the demo shows an approval and a rejection on demand rather than
 * waiting on a real review queue.
 */
export function lastNameFor(status: ApplicationStatus, prefix = 'Test'): string {
  return `${prefix}${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

/**
 * Rain requires `entity.industry` to be a 6-digit NAICS code, not a description.
 * Sending a prose value fails with:
 *   400 FST_ERR_VALIDATION "body/entity/industry must be equal to one of the allowed values"
 *
 * The first two digits are the major sector; 48-49 is Transportation and Warehousing.
 * Both the 2017 and 2022 NAICS revisions are accepted.
 */
export const NAICS_FREIGHT_BROKERAGE = '488510'; // Freight Transportation Arrangement
export const NAICS_TRUCKING_LONG_DISTANCE = '484121'; // General Freight Trucking, Long-Distance
export const NAICS_COURIERS = '492110'; // Couriers and Express Delivery Services
export const NAICS_SOFTWARE_PUBLISHERS = '513210'; // Software Publishers
export const NAICS_MANAGEMENT_CONSULTING = '541611'; // Administrative Management Consulting
export const NAICS_PORTFOLIO_MANAGEMENT = '523940'; // Portfolio Management
export const NAICS_INVESTMENT_ADVICE = '523930'; // Investment Advice
export const NAICS_PAYMENT_PROCESSING = '522320'; // Financial Transactions Processing
export const NAICS_AIR_FREIGHT = '481112'; // Scheduled Freight Air Transportation

const HQ: PhysicalAddress = {
  line1: '450 Mission Street',
  line2: 'Suite 300',
  city: 'San Francisco',
  region: 'CA',
  postalCode: '94105',
  countryCode: 'US',
};

function person(
  firstName: string,
  status: ApplicationStatus,
  email: string,
  overrides: Partial<ApplicationPerson> = {},
): ApplicationPerson {
  return {
    firstName,
    lastName: lastNameFor(status),
    birthDate: '1988-04-12',
    nationalId: '123456789',
    countryOfIssue: 'US',
    email,
    phoneCountryCode: '1',
    phoneNumber: '4155550142',
    address: HQ,
    ...overrides,
  };
}

export interface CompanyFixtureOptions {
  /** Status every person on the application is driven to. */
  status?: ApplicationStatus;
  companyName?: string;
  /**
   * Registered legal name. Kept separate from `companyName` because the trading name
   * carries the sandbox status token, and "Acme Approved X7K Inc." is not a legal entity.
   */
  entityName?: string;
  /** 6-digit NAICS code. Rain rejects anything else. */
  industry?: string;
  /** Rain-managed corporate contracts need an owner wallet on the initial user. */
  walletAddress?: string;
  /** Unique suffix so repeated demo runs do not collide on email addresses. */
  nonce?: string;
}

/**
 * A complete, valid corporate application. Every field Rain marks required is present -
 * a partial body is rejected with a 400 that does not say which field is missing.
 */
export function corporateApplication(
  opts: CompanyFixtureOptions = {},
): CreateCompanyApplicationBody {
  const status = opts.status ?? 'approved';
  const nonce = opts.nonce ?? Date.now().toString(36);
  const domain = `mesta-demo-${nonce}.example.com`;
  // The status token has to live in the company name for corporate applications.
  const token = `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  const companyName = opts.companyName ?? `Northwind Logistics ${token} ${nonce.toUpperCase()}`;

  return {
    name: companyName,
    address: HQ,
    externalId: `mesta-${nonce}`,
    initialUser: {
      ...person('Dana', status, `dana@${domain}`),
      role: 'Chief Financial Officer',
      // Rain-managed: this wallet becomes an owner on the company's collateral contract.
      // Required - omitting it fails with "body is missing required properties
      // 'walletAddress' or 'solanaAddress' or 'tronAddress' or 'stellarAddress'".
      walletAddress: opts.walletAddress ?? config.ownerAddress,
      ipAddress: '203.0.113.42',
      isTermsOfServiceAccepted: true,
    },
    entity: {
      name: opts.entityName ?? `${companyName} Inc.`,
      type: 'C Corp',
      description: 'Freight brokerage and last-mile logistics for regional retailers.',
      industry: opts.industry ?? NAICS_FREIGHT_BROKERAGE,
      registrationNumber: `REG-${nonce.toUpperCase()}`,
      taxId: '87-1234567',
      website: `https://${domain}`,
      expectedSpend: '250000',
    },
    representatives: [person('Dana', status, `dana@${domain}`)],
    ultimateBeneficialOwners: [
      person('Dana', status, `dana@${domain}`),
      person('Marco', status, `marco@${domain}`),
    ],
  };
}

/** Employees who will hold cards. Their last name drives their own KYC outcome. */
export function cardholders(nonce: string, status: ApplicationStatus = 'approved') {
  const domain = `mesta-demo-${nonce}.example.com`;
  return [
    {
      firstName: 'Priya',
      lastName: lastNameFor(status),
      email: `priya@${domain}`,
      phoneCountryCode: '1',
      phoneNumber: '4155550188',
      address: HQ,
      externalId: `emp-priya-${nonce}`,
    },
    {
      firstName: 'Tomas',
      lastName: lastNameFor(status),
      email: `tomas@${domain}`,
      phoneCountryCode: '1',
      phoneNumber: '4155550199',
      address: HQ,
      externalId: `emp-tomas-${nonce}`,
    },
  ];
}

/** Merchants used by the simulated spend, chosen so the MCCs differ visibly in a demo. */
export const MERCHANTS = [
  { merchantName: 'Shell Oil 45871', merchantCategoryCode: '5541', amount: 8_450 },
  { merchantName: 'Delta Air Lines', merchantCategoryCode: '3058', amount: 142_300 },
  { merchantName: 'Iron Hill Freightworks', merchantCategoryCode: '4214', amount: 61_275 },
  { merchantName: 'Blue Bottle Coffee', merchantCategoryCode: '5814', amount: 1_875 },
] as const;
