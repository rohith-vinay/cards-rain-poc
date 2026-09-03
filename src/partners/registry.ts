/**
 * Partner registry.
 *
 * Rain has no concept of a partner. Subtenants would give us data isolation, but they
 * are not contracted on this tenant yet (GET /issuing/subtenants returns 403), and even
 * with them Rain has no per-subtenant card design setting - card art is chosen per card
 * at issuance.
 *
 * So the partner -> design mapping lives here, on the Mesta side, and is resolved from
 * the company's partner at issuance time. It is never accepted from a request body:
 * Rain validates only that an art id is enabled for the program, NOT that the caller is
 * the partner entitled to it, so a pass-through would let one partner issue cards in
 * another partner's branding.
 */

export interface PartnerDesign {
  /** Virtual card appearance. Contract-gated with Rain; inert until enabled. */
  virtualCardArt?: string;
  /** Physical card appearance. Immutable once a card is created. */
  productRef?: string;
  /** BIN range. Only if the partner has its own BIN. */
  productId?: string;
}

export interface PartnerBrand {
  /** Accent used by the portal UI for this partner. */
  accent: string;
  /** Card face gradient, purely presentational. */
  cardFrom: string;
  cardTo: string;
  /** Text on the card face. */
  cardInk: string;
}

export interface Partner {
  id: string;
  name: string;
  /** How the partner refers to the businesses it onboards. */
  customerNoun: string;
  design: PartnerDesign;
  brand: PartnerBrand;
}

export const PARTNERS: Partner[] = [
  {
    id: 'partner-cargobill',
    name: 'CargoBill Inc.',
    customerNoun: 'shipper',
    design: {
      virtualCardArt: 'cargobill-virtual-v1',
      productRef: 'cargobill-physical-v1',
    },
    // Aviation navy - freight and logistics.
    brand: {
      accent: '#1D4E9B',
      cardFrom: '#0F3369',
      cardTo: '#2C68C6',
      cardInk: '#EEF4FF',
    },
  },
  {
    id: 'partner-abra',
    name: 'ABRA Capital Management, LP',
    customerNoun: 'portfolio company',
    design: {
      virtualCardArt: 'abra-virtual-v1',
      productRef: 'abra-physical-v1',
    },
    // Oxblood - reads as asset management rather than tech.
    brand: {
      accent: '#8C2B45',
      cardFrom: '#5C1628',
      cardTo: '#A83B57',
      cardInk: '#FDF0F3',
    },
  },
  {
    id: 'partner-maksupay',
    name: 'MaksuPay LLC',
    customerNoun: 'merchant',
    design: {
      virtualCardArt: 'maksupay-virtual-v1',
      productRef: 'maksupay-physical-v1',
    },
    // Emerald - payments.
    brand: {
      accent: '#0B7A5F',
      cardFrom: '#054A3B',
      cardTo: '#11A37F',
      cardInk: '#EBFAF4',
    },
  },
];

export function getPartner(partnerId: string): Partner | undefined {
  return PARTNERS.find((p) => p.id === partnerId);
}

/**
 * The only sanctioned way to obtain card design. Takes a partner, not a request.
 *
 * Design fields are contract-gated: Rain 400s on an art id that is not enabled for the
 * program. Until custom art is contracted, `includeDesign` stays false so cards issue
 * successfully and the branding remains a Mesta-side concern the UI renders.
 */
export function resolveCardDesign(
  partnerId: string,
  includeDesign = process.env.RAIN_CUSTOM_CARD_ART === 'true',
): PartnerDesign {
  if (!includeDesign) return {};
  const partner = getPartner(partnerId);
  if (!partner) return {};
  return { ...partner.design };
}

/** Strip any caller-supplied design so it can never reach Rain. */
export function stripClientDesign<T extends Record<string, unknown>>(
  configuration: T | undefined,
): Omit<T, 'virtualCardArt' | 'productRef' | 'productId'> | undefined {
  if (!configuration) return undefined;
  const { virtualCardArt, productRef, productId, ...safe } = configuration;
  return safe;
}
