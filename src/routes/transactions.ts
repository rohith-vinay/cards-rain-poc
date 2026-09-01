import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { rain } from '../rain/client.js';

export const transactionsRouter = Router();

transactionsRouter.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    res.json(
      await rain.listTransactions({
        companyId: req.query.companyId as string | undefined,
        userId: req.query.userId as string | undefined,
        cardId: req.query.cardId as string | undefined,
        limit: Number(req.query.limit) || 50,
        cursor: req.query.cursor as string | undefined,
      }),
    );
  }),
);

transactionsRouter.get(
  '/transactions/:transactionId',
  asyncHandler(async (req, res) => {
    res.json(await rain.getTransaction(req.params.transactionId!));
  }),
);

/** Expense-management surface: attach a memo to a transaction. */
transactionsRouter.patch(
  '/transactions/:transactionId',
  asyncHandler(async (req, res) => {
    await rain.updateTransaction(req.params.transactionId!, { memo: req.body?.memo });
    res.json(await rain.getTransaction(req.params.transactionId!));
  }),
);
