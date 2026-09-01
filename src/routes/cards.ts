import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { HttpError } from '../lib/errors.js';
import { resolveCardDesign, stripClientDesign } from '../partners/registry.js';
import { rain } from '../rain/client.js';
import type { CardLimitFrequency, CardStatus, CardType } from '../rain/types.js';
import { db } from '../store/db.js';

export const cardsRouter = Router();

const FREQUENCIES: CardLimitFrequency[] = [
  'per24HourPeriod',
  'per7DayPeriod',
  'per30DayPeriod',
  'perYearPeriod',
  'allTime',
  'perAuthorization',
];

const CARD_STATUSES: CardStatus[] = ['notActivated', 'active', 'locked', 'canceled'];

/** Issue a card to an employee. Virtual cards are active immediately. */
cardsRouter.post(
  '/users/:userId/cards',
  asyncHandler(async (req, res) => {
    const type: CardType = req.body?.type ?? 'virtual';
    if (type !== 'virtual' && type !== 'physical') {
      throw new HttpError(400, 'type must be "virtual" or "physical".');
    }
    if (type === 'physical' && !req.body?.shipping) {
      throw new HttpError(400, 'Physical cards require a shipping address with a phoneNumber.');
    }

    const limit = req.body?.limit;
    if (limit) validateLimit(limit);

    // Card design is resolved from the company's partner, never from the request.
    // Rain validates only that an art id is enabled for the program - not that the
    // caller owns it - so a pass-through would let one partner issue cards in another
    // partner's branding.
    const business = req.body?.companyId ? db.findBusiness(req.body.companyId) : undefined;
    const design = business ? resolveCardDesign(business.partnerId) : {};

    const card = await rain.createCard(req.params.userId!, {
      type,
      status: req.body?.status ?? 'active',
      limit,
      configuration: { ...stripClientDesign(req.body?.configuration), ...design },
      billing: req.body?.billing,
      shipping: req.body?.shipping,
    });

    db.push('cardIds', card.id);
    if (business) {
      db.upsertBusiness({ ...business, cardIds: [...new Set([...business.cardIds, card.id])] });
    }
    res.status(201).json(card);
  }),
);

cardsRouter.get(
  '/cards',
  asyncHandler(async (req, res) => {
    res.json(
      await rain.listCards({
        companyId: req.query.companyId as string | undefined,
        userId: req.query.userId as string | undefined,
        status: req.query.status as string | undefined,
        limit: Number(req.query.limit) || 50,
      }),
    );
  }),
);

cardsRouter.get(
  '/cards/:cardId',
  asyncHandler(async (req, res) => {
    res.json(await rain.getCard(req.params.cardId!));
  }),
);

/** Card configuration: spend limit, billing address, virtual art, status. */
cardsRouter.patch(
  '/cards/:cardId',
  asyncHandler(async (req, res) => {
    if (req.body?.limit) validateLimit(req.body.limit);
    if (req.body?.status && !CARD_STATUSES.includes(req.body.status)) {
      throw new HttpError(400, `status must be one of ${CARD_STATUSES.join(', ')}.`);
    }
    res.json(
      await rain.updateCard(req.params.cardId!, {
        ...req.body,
        configuration: stripClientDesign(req.body?.configuration),
      }),
    );
  }),
);

/**
 * Lifecycle shortcuts. Locking is reversible; cancelling is not, so it is spelled out
 * as its own route rather than hidden behind a status patch.
 */
cardsRouter.post(
  '/cards/:cardId/lock',
  asyncHandler(async (req, res) => {
    res.json(await rain.updateCard(req.params.cardId!, { status: 'locked' }));
  }),
);

cardsRouter.post(
  '/cards/:cardId/unlock',
  asyncHandler(async (req, res) => {
    res.json(await rain.updateCard(req.params.cardId!, { status: 'active' }));
  }),
);

cardsRouter.post(
  '/cards/:cardId/cancel',
  asyncHandler(async (req, res) => {
    if (req.body?.confirm !== true) {
      throw new HttpError(
        400,
        'Cancelling a card is permanent. Send {"confirm": true} to proceed.',
      );
    }
    res.json(await rain.updateCard(req.params.cardId!, { status: 'canceled' }));
  }),
);

cardsRouter.post(
  '/cards/:cardId/limit',
  asyncHandler(async (req, res) => {
    validateLimit(req.body);
    res.json(await rain.updateCard(req.params.cardId!, { limit: req.body }));
  }),
);

/**
 * Full card number and CVC. Requires a SessionId header holding an encrypted session id
 * generated against Rain's published sandbox public key, and returns ciphertext that has
 * to be decrypted with the matching private key.
 *
 * Not wired into the demo: the simulator authorizes against the card id, so nothing in
 * this POC needs the PAN. Left here so the surface is complete and honest about the gap.
 */
cardsRouter.get(
  '/cards/:cardId/secrets',
  asyncHandler(async (req, res) => {
    const sessionId = req.header('SessionId');
    if (!sessionId) {
      throw new HttpError(
        400,
        'Pass a SessionId header. Generate it from Rain\'s sandbox SessionId public key; ' +
          'the response is encrypted and must be decrypted with your matching private key.',
      );
    }
    res.json(await rain.getCardSecrets(req.params.cardId!, sessionId));
  }),
);

function validateLimit(limit: unknown): void {
  const l = limit as { amount?: unknown; frequency?: unknown };
  if (!Number.isInteger(l?.amount) || (l.amount as number) <= 0) {
    throw new HttpError(400, 'limit.amount must be a positive integer number of cents.');
  }
  if (!FREQUENCIES.includes(l?.frequency as CardLimitFrequency)) {
    throw new HttpError(400, `limit.frequency must be one of ${FREQUENCIES.join(', ')}.`);
  }
}
