import { createHmac } from 'node:crypto';

/**
 * Work out how Rain actually signed a request when verification fails.
 *
 * Tries every plausible combination of key, digest encoding, and signed payload, and
 * reports which one reproduces the header. Enable with WEBHOOK_DEBUG=true.
 */
export function diagnoseSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  keys: Array<{ label: string; value: string }>,
): string {
  const lines: string[] = [];

  const sigHeaders = Object.entries(headers).filter(([k]) =>
    /signature|sign|hmac|digest|timestamp|rain/i.test(k),
  );
  lines.push('  headers of interest:');
  for (const [k, v] of sigHeaders) lines.push(`    ${k}: ${String(v)}`);
  if (sigHeaders.length === 0) lines.push('    (none matched signature/timestamp patterns)');

  const given = String(headers['signature'] ?? '').trim();
  if (!given) return lines.join('\n');

  lines.push(`  given signature: ${given}  (length ${given.length})`);
  lines.push('  candidates:');

  const timestamp = String(headers['timestamp'] ?? headers['x-timestamp'] ?? '');
  const payloads: Array<[string, Buffer]> = [
    ['raw body', rawBody],
    ...(timestamp
      ? ([['timestamp.body', Buffer.concat([Buffer.from(`${timestamp}.`), rawBody])]] as Array<
          [string, Buffer]
        >)
      : []),
  ];

  for (const { label, value } of keys) {
    for (const [payloadLabel, payload] of payloads) {
      for (const enc of ['hex', 'base64'] as const) {
        const digest = createHmac('sha256', value).update(payload).digest(enc);
        const hit = digest === given || `sha256=${digest}` === given;
        lines.push(`    ${hit ? 'MATCH ->' : '        '} ${label} / ${payloadLabel} / ${enc}: ${digest.slice(0, 24)}...`);
      }
    }
  }

  return lines.join('\n');
}
