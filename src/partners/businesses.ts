/**
 * The business catalogue: one source of truth for the seed script, the card routes and
 * the portal.
 *
 * `cardName` is the short trading name that goes on the card. It is chosen, not derived:
 * Rain allows one 26-character name and it has to hold the cardholder too, so
 * "GLOBER SERVICOS FINANCEIROS LTDA" cannot be truncated into it without looking broken.
 * Real corporate cards emboss a trading name rather than the registered entity for
 * exactly this reason.
 */
export interface BusinessProfile {
  /** Registered name, shown throughout the portal. */
  name: string;
  /** Legal entity name sent to Rain on the application. */
  entityName: string;
  /** 6-digit NAICS code. */
  industry: string;
  /** Short name embossed on the card, alongside the cardholder. */
  cardName: string;
}

export const NAICS = {
  airFreight: '481112',
  couriers: '492110',
  softwarePublishers: '513210',
  portfolioManagement: '523940',
  investmentAdvice: '523930',
  paymentProcessing: '522320',
} as const;

export const BUSINESSES: Record<string, BusinessProfile[]> = {
  'partner-cargobill': [
    {
      name: 'TRUST AIR CARGO U.S.A. CO.',
      entityName: 'Trust Air Cargo U.S.A. Co.',
      industry: NAICS.airFreight,
      cardName: 'TRUST AIR',
    },
    {
      name: 'COGO UNIVERSE PTE. LTD.',
      entityName: 'Cogo Universe Pte. Ltd.',
      industry: NAICS.couriers,
      cardName: 'COGO UNIVERSE',
    },
    {
      name: 'Galleon Technology, Inc.',
      entityName: 'Galleon Technology, Inc.',
      industry: NAICS.softwarePublishers,
      cardName: 'GALLEON',
    },
  ],
  'partner-abra': [
    {
      name: 'GB Sales LLC',
      entityName: 'GB Sales LLC',
      industry: NAICS.portfolioManagement,
      cardName: 'GB SALES',
    },
    {
      name: 'Moxley Group Limited',
      entityName: 'Moxley Group Limited',
      industry: NAICS.investmentAdvice,
      cardName: 'MOXLEY GROUP',
    },
  ],
  'partner-maksupay': [
    {
      name: 'GLOBER SERVICOS FINANCEIROS LTDA',
      entityName: 'Glober Servicos Financeiros Ltda',
      industry: NAICS.paymentProcessing,
      cardName: 'GLOBER',
    },
    {
      name: 'Palomita Holdings',
      entityName: 'Palomita Holdings',
      industry: NAICS.paymentProcessing,
      cardName: 'PALOMITA',
    },
  ],
};

const BY_NAME = new Map(
  Object.values(BUSINESSES).flat().map((b) => [b.name, b] as const),
);

export function businessProfile(name: string): BusinessProfile | undefined {
  return BY_NAME.get(name);
}
