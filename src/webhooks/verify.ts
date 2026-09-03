import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Rain signs each webhook with an HMAC-SHA256 of the exact raw request body, keyed by one
 * of your tenant API keys, and sends it in `Signature`. During a signing-key rotation it
 * also sends `Secondary-Signature`, and either may be the valid one.
 *
 * The comparison must run against the raw bytes: re-serialising parsed JSON changes key
 * order and whitespace and will never match.
 */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secondaryHeader?: string | undefined,
): boolean {
  const candidates = [signatureHeader, secondaryHeader].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  if (candidates.length === 0) return false;

  const keys = [config.webhookSigningKey, config.webhookSigningKeySecondary].filter(
    (k): k is string => typeof k === 'string' && k.length > 0,
  );

  return candidates.some((candidate) =>
    keys.some((key) => matches(rawBody, key, candidate)),
  );
}

function matches(rawBody: Buffer, key: string, candidate: string): boolean {
  const expected = createHmac('sha256', key).update(rawBody).digest('hex');
  const given = candidate.trim().replace(/^sha256=/i, '').toLowerCase();
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
