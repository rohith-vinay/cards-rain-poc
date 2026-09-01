import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in before starting the server.`,
    );
  }
  return v.trim();
}

function optional(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

const baseUrl = optional('RAIN_BASE_URL', 'https://api-dev.raincards.xyz/v1').replace(/\/+$/, '');

if (/api\.raincards\.xyz/.test(baseUrl)) {
  throw new Error(
    'RAIN_BASE_URL points at production. This POC is sandbox-only - the /simulate endpoints ' +
      'it depends on return 404 in production. Use https://api-dev.raincards.xyz/v1.',
  );
}

export const config = {
  apiKey: required('RAIN_API_KEY'),
  baseUrl,
  /** Rain signs webhooks with one of your tenant API keys; default to the same key. */
  webhookSigningKey: optional('RAIN_WEBHOOK_SIGNING_KEY') || required('RAIN_API_KEY'),
  webhookSigningKeySecondary: optional('RAIN_WEBHOOK_SIGNING_KEY_SECONDARY') || null,
  enforceWebhookSignature: optional('WEBHOOK_ENFORCE_SIGNATURE', 'true') !== 'false',
  chainId: Number(optional('RAIN_CHAIN_ID', '84532')),
  ownerAddress: optional('RAIN_OWNER_ADDRESS'),
  port: Number(optional('PORT', '4000')),
} as const;

export type Config = typeof config;
