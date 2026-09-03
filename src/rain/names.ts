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
 * The single name Rain will carry: the business's short trading name followed by the
 * cardholder. Rain allows 26 characters and only letters, digits, spaces, periods and
 * hyphens, so this uppercases, strips anything else, and protects the cardholder's name
 * if the pair ever runs long.
 */
export function embossedName(cardName: string | undefined, holder: string): string {
  const strip = (v: string) =>
    v.replace(/[^A-Za-z0-9 .-]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

  const person = strip(holder);
  if (!cardName) return person.slice(0, 26).trim();

  const business = strip(cardName);
  const combined = `${business} ${person}`;
  if (combined.length <= 26) return combined;

  // Never truncate the cardholder - shorten the business instead, and drop it entirely
  // rather than leave an unrecognisable stub.
  const room = 26 - person.length - 1;
  return room >= 4 ? `${business.slice(0, room).trim()} ${person}` : person.slice(0, 26);
}
