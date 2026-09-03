import express, { Router } from 'express';
import { config } from '../config.js';
import { db, type WebhookEvent } from '../store/db.js';
import { eventBus } from './events.js';
import { diagnoseSignature } from './diagnose.js';
import { verifySignature } from './verify.js';

export const webhookRouter = Router();

/**
 * Rain's receiver.
 *
 * express.raw keeps the body as bytes so the HMAC can be checked against exactly what
 * Rain signed. Mounting any JSON parser ahead of this route breaks verification.
 */
webhookRouter.post(
  '/rain',
  express.raw({ type: '*/*', limit: '2mb' }),
  (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

    const signatureValid = verifySignature(
      raw,
      req.header('Signature') ?? undefined,
      req.header('Secondary-Signature') ?? undefined,
    );

    if (!signatureValid && config.webhookDebug) {
      console.warn(
        '[webhook] signature did not verify - diagnosing:\n' +
          diagnoseSignature(raw, req.headers as Record<string, string | string[] | undefined>, [
            { label: 'signingKey', value: config.webhookSigningKey },
            ...(config.webhookSigningKeySecondary
              ? [{ label: 'secondaryKey', value: config.webhookSigningKeySecondary }]
              : []),
            { label: 'apiKey', value: config.apiKey },
          ]),
      );
    }

    if (!signatureValid && config.enforceWebhookSignature) {
      console.warn('[webhook] rejected: signature did not verify');
      res.status(401).json({ error: 'invalid signature' });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: 'body was not valid JSON' });
      return;
    }

    const resource = String(payload.resource ?? 'unknown');
    const action = String(payload.action ?? 'unknown');
    const event: WebhookEvent = {
      id: String(payload.id ?? `${resource}.${action}.${Date.now()}`),
      resource,
      action,
      version: payload.version ? String(payload.version) : undefined,
      receivedAt: new Date().toISOString(),
      signatureValid,
      payload,
    };

    // Answer immediately - anything but a 2xx is a failed delivery and Rain will retry
    // up to 15 times. Retries mean the same envelope id arrives more than once.
    res.status(200).json({ received: true });

    const isNew = db.addEvent(event);
    if (!isNew) {
      console.log(`[webhook] duplicate ${resource}.${action} (${event.id}) ignored`);
      return;
    }

    console.log(`[webhook] ${resource}.${action} ${event.id}`);
    eventBus.publish(event);
  },
);
