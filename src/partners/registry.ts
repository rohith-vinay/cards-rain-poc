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
    id: 'partner-a',
    name: 'Partner A',
    customerNoun: 'business',
    design: {
      virtualCardArt: 'partner-a-virtual-v1',
      productRef: 'partner-a-physical-v1',
    },
    brand: {
      accent: '#2F5DD6',
      cardFrom: '#1E3A8A',
      cardTo: '#3B6FE0',
      cardInk: '#F2F6FF',
    },
  },
  {
    id: 'partner-b',
    name: 'Partner B',
    customerNoun: 'business',
    design: {
      virtualCardArt: 'partner-b-virtual-v1',
      productRef: 'partner-b-physical-v1',
    },
    brand: {
      accent: '#0E7C66',
      cardFrom: '#0B5A4A',
      cardTo: '#16A085',
      cardInk: '#EEFBF7',
    },
  },
  {
    id: 'partner-c',
    name: 'Partner C',
    customerNoun: 'business',
    design: {
      virtualCardArt: 'partner-c-virtual-v1',
      productRef: 'partner-c-physical-v1',
    },
    brand: {
      accent: '#6D3FC4',
      cardFrom: '#4C2A8C',
      cardTo: '#7C4DDB',
      cardInk: '#F5F0FF',
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
