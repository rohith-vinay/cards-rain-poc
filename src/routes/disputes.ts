import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { HttpError } from '../lib/errors.js';
import { rain } from '../rain/client.js';
import type { DisputeType } from '../rain/types.js';
import { db } from '../store/db.js';

export const disputesRouter = Router();

const DISPUTE_TYPES: DisputeType[] = [
  'fraud',
  'creditNotProcessed',
  'serviceNotReceived',
  'merchandiseIssue',
  'other',
];

/**
 * Open a dispute. Rain only accepts these against a transaction that has actually
 * settled and has a non-zero amount, so this cannot run against an open authorization.
 */
disputesRouter.post(
  '/transactions/:transactionId/disputes',
  asyncHandler(async (req, res) => {
    const disputeType = req.body?.disputeType as DisputeType | undefined;
    if (disputeType && !DISPUTE_TYPES.includes(disputeType)) {
      throw new HttpError(400, `disputeType must be one of ${DISPUTE_TYPES.join(', ')}.`);
    }
    const dispute = await rain.createDispute(req.params.transactionId!, {
      disputeType,
      textEvidence: req.body?.textEvidence,
      disputeAmount: req.body?.disputeAmount,
    });
    db.push('disputeIds', dispute.id);
    res.status(201).json(dispute);
  }),
);

disputesRouter.get(
  '/disputes',
  asyncHandler(async (req, res) => {
    res.json(
      await rain.listDisputes({
        companyId: req.query.companyId as string | undefined,
        userId: req.query.userId as string | undefined,
        status: req.query.status as string | undefined,
        limit: Number(req.query.limit) || 50,
      }),
    );
  }),
);

disputesRouter.get(
  '/disputes/:disputeId',
  asyncHandler(async (req, res) => {
    res.json(await rain.getDispute(req.params.disputeId!));
  }),
);

disputesRouter.patch(
  '/disputes/:disputeId',
  asyncHandler(async (req, res) => {
    await rain.updateDispute(req.params.disputeId!, req.body);
    res.json(await rain.getDispute(req.params.disputeId!));
  }),
);
