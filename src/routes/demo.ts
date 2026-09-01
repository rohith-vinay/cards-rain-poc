import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { HttpError } from '../lib/errors.js';
import { runDemo } from '../demo/flow.js';
import { db } from '../store/db.js';

export const demoRouter = Router();

let running = false;

/**
 * Run the whole program end to end. Takes a couple of minutes, mostly waiting on KYB
 * and the contract deploy, so a demo usually runs this once beforehand and then walks
 * the leadership through /api/demo/state and the event stream.
 */
demoRouter.post(
  '/run',
  asyncHandler(async (req, res) => {
    if (running) throw new HttpError(409, 'A demo run is already in progress.');
    running = true;
    try {
      const summary = await runDemo({
        fundingAmount: req.body?.fundingAmount ? Number(req.body.fundingAmount) : undefined,
        reuseCompanyId: req.body?.reuseCompanyId,
      });
      res.status(summary.failed ? 500 : 200).json(summary);
    } finally {
      running = false;
    }
  }),
);

/** Everything the POC has built so far, for a dashboard to render. */
demoRouter.get('/state', (_req, res) => {
  const state = db.get();
  res.json({
    running,
    company: { id: state.companyId, name: state.companyName },
    contractId: state.contractId,
    counts: {
      cardholders: state.userIds.length,
      cards: state.cardIds.length,
      transactions: state.transactionIds.length,
      disputes: state.disputeIds.length,
      events: state.events.length,
    },
    userIds: state.userIds,
    cardIds: state.cardIds,
    steps: state.demoLog,
    recentEvents: state.events.slice(0, 20),
  });
});

/** Clear local bookkeeping only. Nothing is deleted on Rain's side. */
demoRouter.post('/reset', (_req, res) => {
  db.reset();
  res.json({ reset: true, note: 'Local state cleared. Companies and cards still exist in Rain.' });
});
