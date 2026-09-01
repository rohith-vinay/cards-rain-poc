import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { HttpError, RainApiError } from './lib/errors.js';
import { cardsRouter } from './routes/cards.js';
import { companiesRouter } from './routes/companies.js';
import { demoRouter } from './routes/demo.js';
import { disputesRouter } from './routes/disputes.js';
import { eventsRouter } from './routes/events.js';
import { simulateRouter } from './routes/simulate.js';
import { transactionsRouter } from './routes/transactions.js';
import { usersRouter } from './routes/users.js';
import { webhookRouter } from './webhooks/router.js';

const app = express();
app.disable('x-powered-by');

// The webhook receiver must see raw bytes to verify Rain's HMAC, so it is mounted
// BEFORE the JSON parser. Moving this below express.json() silently breaks signatures.
app.use('/webhooks', webhookRouter);

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    environment: 'sandbox',
    baseUrl: config.baseUrl,
    chainId: config.chainId,
    signatureEnforced: config.enforceWebhookSignature,
  });
});

app.use('/api/companies', companiesRouter);
app.use('/api', usersRouter);
app.use('/api', cardsRouter);
app.use('/api', transactionsRouter);
app.use('/api', disputesRouter);
app.use('/api', eventsRouter);
app.use('/api/simulate', simulateRouter);
app.use('/api/demo', demoRouter);

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof RainApiError) {
    console.error(`[rain] ${err.message}`, err.body);
    res.status(err.status).json({
      error: err.message,
      detail: err.body,
      ...(err.isSimulatorUnavailable && {
        hint:
          'The /simulate endpoints return 404 in production and when the tenant is not enabled ' +
          'for simulation. Confirm with Rain that simulation is switched on for this sandbox tenant.',
      }),
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, detail: err.detail });
    return;
  }

  console.error('[unhandled]', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
});

app.listen(config.port, () => {
  console.log(`\nRain sandbox backend listening on http://localhost:${config.port}`);
  console.log(`  Rain base URL     ${config.baseUrl}`);
  console.log(`  Webhook receiver  POST /webhooks/rain`);
  console.log(`  Event stream      GET  /api/events/stream`);
  console.log(`  Run the demo      POST /api/demo/run   (or: npm run demo)`);
  if (!config.enforceWebhookSignature) {
    console.warn('  WARNING: webhook signature checking is disabled.');
  }
  if (!config.ownerAddress || /^0x0+$/.test(config.ownerAddress)) {
    console.warn('  WARNING: RAIN_OWNER_ADDRESS is unset - collateral contract creation will fail.');
  }
  console.log('');
});
