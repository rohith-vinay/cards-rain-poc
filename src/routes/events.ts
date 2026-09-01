import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { rain } from '../rain/client.js';
import { db } from '../store/db.js';
import { eventBus } from '../webhooks/events.js';

export const eventsRouter = Router();

/** Webhook events this server has received, newest first. */
eventsRouter.get('/events', (req, res) => {
  const { resource, action } = req.query as { resource?: string; action?: string };
  const limit = Number(req.query.limit) || 100;
  const events = db
    .get()
    .events.filter((e) => (!resource || e.resource === resource) && (!action || e.action === action))
    .slice(0, limit);
  res.json({ count: events.length, events });
});

/**
 * Live event stream for a demo screen. Server-sent events rather than websockets:
 * one-way, survives proxies, and reconnects on its own.
 */
eventsRouter.get('/events/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`: connected at ${new Date().toISOString()}\n\n`);

  const unsubscribe = eventBus.subscribe((event) => {
    res.write(`event: ${event.resource}.${event.action}\n`);
    res.write(`id: ${event.id}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

/** Rain's own record of what it tried to deliver - useful when our endpoint was down. */
eventsRouter.get(
  '/events/deliveries',
  asyncHandler(async (req, res) => {
    res.json(
      await rain.listWebhookDeliveries({
        resourceType: req.query.resourceType as string | undefined,
        resourceId: req.query.resourceId as string | undefined,
        limit: Number(req.query.limit) || 50,
      }),
    );
  }),
);

eventsRouter.get(
  '/webhooks/configuration',
  asyncHandler(async (_req, res) => {
    res.json(await rain.getWebhookConfiguration());
  }),
);

eventsRouter.patch(
  '/webhooks/configuration',
  asyncHandler(async (req, res) => {
    res.json(await rain.patchWebhookConfiguration(req.body));
  }),
);
