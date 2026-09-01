import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { HttpError } from '../lib/errors.js';
import { getPartner, PARTNERS } from '../partners/registry.js';
import { rain } from '../rain/client.js';
import { holderLabel } from '../rain/names.js';
import type { IssuingCard, IssuingTransaction } from '../rain/types.js';
import { db } from '../store/db.js';

export const portalRouter = Router();

/**
 * Everything the portal needs to draw its navigation: partners and the businesses
 * grouped beneath them.
 *
 * The grouping is Mesta-side. Rain's equivalent is a subtenant, which is not contracted
 * on this tenant yet, so `rainEnforced` is false and the UI says so rather than implying
 * an isolation boundary that does not exist.
 */
portalRouter.get('/context', (_req, res) => {
  const businesses = db.get().businesses;
  res.json({
    rainEnforced: false,
    isolationNote:
      'Partner grouping is maintained by Mesta. Rain subtenants are not contracted on this ' +
      'sandbox tenant, so Rain sees one program.',
    partners: PARTNERS.map((p) => ({
      id: p.id,
      name: p.name,
      customerNoun: p.customerNoun,
      brand: p.brand,
      design: p.design,
      // Sorted by name so the picker order is stable regardless of what has been
      // touched since seeding.
      businesses: businesses
        .filter((b) => b.partnerId === p.id)
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
        .map((b) => ({ companyId: b.companyId, name: b.name, cards: b.cardIds.length })),
    })),
  });
});

/** One business: balances, cardholders, cards, and recent card activity. */
portalRouter.get(
  '/business/:companyId',
  asyncHandler(async (req, res) => {
    const companyId = req.params.companyId!;
    const business = db.findBusiness(companyId);
    if (!business) throw new HttpError(404, 'Unknown business. Run the seed script first.');

    const partner = getPartner(business.partnerId);

    // Fetched together so one slow call cannot leave the page half-drawn.
    const [balances, cards, users, transactions] = await Promise.all([
      rain.getCompanyBalances(companyId).catch(() => null),
      rain.listCards({ companyId, limit: 50 }).catch((): IssuingCard[] => []),
      rain.listUsers({ companyId, limit: 50 }).catch(() => []),
      rain.listTransactions({ companyId, limit: 25 }).catch((): IssuingTransaction[] => []),
    ]);

    const holders = new Map(users.map((u) => [u.id, holderLabel(u.firstName, u.lastName)]));

    res.json({
      business: { companyId, name: business.name, contractId: business.contractId },
      partner: partner
        ? { id: partner.id, name: partner.name, brand: partner.brand, design: partner.design }
        : null,
      balances,
      cards: cards.map((c) => ({
        id: c.id,
        last4: c.last4,
        status: c.status,
        type: c.type,
        limit: c.limit,
        expiry: `${c.expirationMonth}/${c.expirationYear}`,
        holder: holders.get(c.userId) ?? 'Unknown',
        userId: c.userId,
      })),
      cardholders: users.map((u) => ({
        id: u.id,
        name: holderLabel(u.firstName, u.lastName),
        email: u.email,
        isActive: u.isActive,
      })),
      transactions: transactions
        .filter((t): t is Extract<IssuingTransaction, { type: 'spend' }> => t.type === 'spend')
        .map((t) => ({
          id: t.id,
          amount: t.spend.amount,
          currency: t.spend.currency,
          merchant: t.spend.merchantName?.trim() ?? '',
          mcc: t.spend.merchantCategoryCode,
          status: t.spend.status,
          declinedReason: t.spend.declinedReason,
          cardId: t.spend.cardId,
          authorizedAt: t.spend.authorizedAt,
          postedAt: t.spend.postedAt,
        })),
    });
  }),
);
