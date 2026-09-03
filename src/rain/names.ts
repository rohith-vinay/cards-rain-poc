import type { ApplicationStatus } from './types.js';

/**
 * Sandbox names carry a status token, because Rain drives an application's outcome from
 * the name: a company from its company name, a person from their last name. An employee
 * whose last name lacks "approved" lands at `pending`, and issuing a card to them fails
 * with 403 "User exists, but is not approved".
 *
 * So the token has to stay on the Rain profile, and comes off only for display.
 */
const STATUS_TOKENS: ApplicationStatus[] = [
  'needsVerification',
  'needsInformation',
  'tosNotAccepted',
  'manualReview',
  'notStarted',
  'approved',
  'canceled',
  'pending',
  'denied',
  'locked',
  'exempt',
];

/** "1Approved" -> "1", "TestApproved" -> "" */
export function stripStatusToken(value: string): string {
  let out = value;
  for (const token of STATUS_TOKENS) {
    out = out.replace(new RegExp(token, 'ig'), '');
  }
  return out.replace(/\bTest\b/gi, '').replace(/\s+/g, ' ').trim();
}

/** The name a person should be shown by: "User" + "1Approved" -> "User 1". */
export function holderLabel(firstName: string, lastName: string): string {
  return `${firstName} ${stripStatusToken(lastName)}`.replace(/\s+/g, ' ').trim();
}

/**
 * The name embossed on the card and sent to the card network. Rain caps this at 26
 * characters and allows only letters, digits, spaces, periods and hyphens.
 */
export function cardDisplayName(firstName: string, lastName: string): string {
  return holderLabel(firstName, lastName)
    .replace(/[^A-Za-z0-9 .-]/g, '')
    .slice(0, 26)
    .trim();
}

/**
 * How the one name Rain carries is composed.
 *
 * Rain does not require the cardholder's name. `configuration.displayName` is optional:
 * omit it and Rain falls back to the user's profile name, set it and Rain uses exactly
 * what you send, with no check that it matches the person. So a corporate programme can
 * put the business on the card instead - which is how most corporate cards read.
 *
 * Rain documents the field as a cardholder name whose purpose is transliterating
 * non-Latin names, so using it for a company is outside its documented intent even
 * though nothing rejects it. Worth confirming with Rain before a live programme.
 */
export type CardNameMode = 'business' | 'business+holder' | 'holder';

const strip = (v: string) =>
  v.replace(/[^A-Za-z0-9 .-]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

const LIMIT = 26;

export interface CardNameInput {
  /** Registered name, preferred when it fits. */
  businessName?: string;
  /** Short trading name, used when the registered one is too long. */
  cardName?: string;
  /** The cardholder, already stripped of the sandbox status token. */
  holder?: string;
}

/**
 * The exact string sent as `configuration.displayName`, capped at Rain's 26 characters
 * and its `[A-Za-z0-9 .-]` character set.
 */
export function embossedName(
  input: CardNameInput,
  mode: CardNameMode = (process.env.CARD_NAME_MODE as CardNameMode) || 'business',
): string {
  const person = strip(input.holder ?? '');
  const registered = strip(input.businessName ?? '');
  const trading = strip(input.cardName ?? '');
  // Prefer the registered name; fall back to the trading name only when it will not fit.
  const business = registered && registered.length <= LIMIT ? registered : trading || registered;

  if (mode === 'holder' || !business) return person.slice(0, LIMIT).trim();
  if (mode === 'business') return business.slice(0, LIMIT).trim();

  if (!person) return business.slice(0, LIMIT).trim();
  const short = trading || business;
  const combined = `${short} ${person}`;
  if (combined.length <= LIMIT) return combined;

  // Never truncate the cardholder - shorten the business, or drop it rather than leave
  // an unrecognisable stub.
  const room = LIMIT - person.length - 1;
  return room >= 4 ? `${short.slice(0, room).trim()} ${person}` : person.slice(0, LIMIT);
}
