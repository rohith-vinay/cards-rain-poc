import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { HttpError } from '../lib/errors.js';
import { rain } from '../rain/client.js';
import { DECLINE_REASONS, type DeclineReason } from '../rain/types.js';
import { db } from '../store/db.js';

export const simulateRouter = Router();

/**
 * Every route here hits Rain's /v1/simulate prefix, which exists only in sandbox and
 * returns 404 in production. These are what make a card program demonstrable without a
 * real merchant, a real card network, or real money.
 */

simulateRouter.get('/decline-reasons', (_req, res) => {
  res.json(DECLINE_REASONS);
});

/** Authorize against a card, exactly as a merchant terminal would. */
simulateRouter.post(
  '/authorize',
  asyncHandler(async (req, res) => {
    const { cardId, merchantName, merchantCategoryCode } = req.body ?? {};
    const amount = Number(req.body?.amount);

    if (!cardId) throw new HttpError(400, 'cardId is required.');
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new HttpError(400, 'amount must be a positive integer number of cents.');
    }
    if (!merchantName) throw new HttpError(400, 'merchantName is required.');
    if (!merchantCategoryCode) {
      throw new HttpError(400, 'merchantCategoryCode is required (a 4-digit MCC, e.g. "5814").');
    }

    const declineReason = req.body?.declineReason as DeclineReason | undefined;
    if (declineReason && !DECLINE_REASONS.includes(declineReason)) {
      throw new HttpError(400, `declineReason must be one of ${DECLINE_REASONS.join(', ')}.`);
    }

    const result = await rain.simulateAuthorize({
      cardId,
      amount,
      currency: req.body?.currency ?? 'USD',
      merchantName,
      merchantCategoryCode,
      declineReason,
    });

    if (result.transactionId) db.push('transactionIds', result.transactionId);
    res.status(201).json(result);
  }),
);

/** Merchant revises the amount before settling - a tip, a fuel top-up. */
simulateRouter.patch(
  '/transactions/:transactionId/authorize',
  asyncHandler(async (req, res) => {
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new HttpError(400, 'amount must be a positive integer number of cents.');
    }
    res.json(await rain.simulateAuthorizeUpdate(req.params.transactionId!, amount));
  }),
);

/**
 * Capture the hold. `amount` is required - Rain rejects the call without it even though
 * the OpenAPI spec marks it optional. Pass the authorized amount to settle in full, or
 * less for a partial capture.
 */
simulateRouter.post(
  '/transactions/:transactionId/settle',
  asyncHandler(async (req, res) => {
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount < 0) {
      throw new HttpError(
        400,
        'amount is required and must be a non-negative integer in cents. ' +
          'Rain rejects a settle with no amount; pass the authorized amount to settle in full.',
      );
    }
    res.json(await rain.simulateSettle(req.params.transactionId!, amount));
  }),
);

/** Release the hold without posting. Pass newAmount for a partial reversal. */
simulateRouter.post(
  '/transactions/:transactionId/reverse',
  asyncHandler(async (req, res) => {
    const newAmount = req.body?.newAmount === undefined ? undefined : Number(req.body.newAmount);
    res.json(await rain.simulateReverse(req.params.transactionId!, newAmount));
  }),
);

/** Credit a settled transaction back to the cardholder. `amount` is required. */
simulateRouter.post(
  '/transactions/:transactionId/refund',
  asyncHandler(async (req, res) => {
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new HttpError(
        400,
        'amount is required and must be a positive integer in cents. ' +
          'Rain rejects a refund with no amount.',
      );
    }
    res.json(await rain.simulateRefund(req.params.transactionId!, amount));
  }),
);

/** Top up the company's collateral. rusd only, amount in cents. */
simulateRouter.post(
  '/collateral/fund',
  asyncHandler(async (req, res) => {
    const contractId = req.body?.contractId ?? db.get().contractId;
    const amount = Number(req.body?.amount);
    if (!contractId) {
      throw new HttpError(400, 'contractId is required (none stored from a previous run).');
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new HttpError(400, 'amount must be a positive integer number of cents.');
    }
    res.status(202).json(await rain.simulateFundCollateral(contractId, amount));
  }),
);
