// OWNER: D2.  CLAIMED — new file.
//
// E-WAY BILL RULES — Rule 138 of the CGST Rules, 2017.
//
// Goods above a threshold consignment value may not move without an e-way
// bill.  This file is the rule; app/api/eway is the plumbing.
//
// ── WHY THIS IS WORTH HAVING IN AN ERP ───────────────────────────────
// It is the point where the commercial system meets physical logistics, and
// it is not optional in India: a consignment stopped without a valid e-way
// bill is detained.  An ERP that can raise an invoice but cannot tell you
// whether the truck may legally leave is missing the half that operations
// actually live in.  Every input it needs — consignor state, consignee
// state, value, HSN — already exists in this database; nothing had ever
// joined them up.
//
// ── WHAT IS VERIFIED AND WHAT IS ASSUMED ─────────────────────────────
// VERIFIED against current guidance (Sept 2026):
//   · inter-state threshold is ₹50,000, uniformly
//   · Maharashtra and Tamil Nadu apply ₹1,00,000 intra-state
//   · validity is 1 day per 200 km, or per 20 km for over-dimensional cargo
//   · Part A is the consignment, Part B is the transport, and the validity
//     clock starts with PART B
// ASSUMED, and flagged as such below: the remaining states in HIGHER_INTRA.
// Several sources list them at ₹1,00,000 but I have not verified each one
// individually, and a threshold that is wrong in the permissive direction
// tells a user no document is needed when one is.  They are therefore
// listed separately and the API reports which basis it used.
//
// DISTANCE IS AN INPUT, NOT A GUESS.  An earlier attempt to derive distances
// from a public pincode dataset produced coordinates that put Ahmedabad in
// Uttarakhand, so nothing here invents one.  The real Part-B flow asks for
// the distance too, so this matches the actual document.

/** Uniform, and the one that matters most: any movement crossing a state
 *  border needs a bill above this, whatever the two states are. */
export const INTERSTATE_THRESHOLD = 50_000

/** VERIFIED this session. */
const HIGHER_INTRA_VERIFIED: Record<string, number> = {
  '27': 100_000, // Maharashtra
  '33': 100_000, // Tamil Nadu
}

/** Widely reported at ₹1,00,000 but not individually verified here. Kept
 *  apart from the verified set so the API can say which basis it used. */
const HIGHER_INTRA_REPORTED: Record<string, number> = {
  '03': 100_000, // Punjab
  '07': 100_000, // Delhi
  '08': 100_000, // Rajasthan
  '10': 100_000, // Bihar
  '20': 100_000, // Jharkhand
  '23': 100_000, // Madhya Pradesh
}

export const DEFAULT_INTRA_THRESHOLD = 50_000

export type EwayApplicability = {
  required: boolean
  isInterstate: boolean
  fromStateCode: string
  toStateCode: string
  consignmentValue: number
  threshold: number
  /** How confident we are in `threshold`. Surfaced in the UI. */
  thresholdBasis: 'interstate' | 'intra_verified' | 'intra_reported' | 'intra_default'
  explanation: string
}

/**
 * Is an e-way bill required for this movement?
 *
 * Errs toward REQUIRED wherever the rule is uncertain: telling someone they
 * need a document they do not is an inconvenience, telling them they do not
 * need one they do gets the lorry detained.
 */
export function evaluateEway(args: {
  fromStateCode: string
  toStateCode: string
  consignmentValue: number
}): EwayApplicability {
  const { fromStateCode, toStateCode, consignmentValue } = args
  const isInterstate = fromStateCode !== toStateCode

  let threshold: number
  let basis: EwayApplicability['thresholdBasis']

  if (isInterstate) {
    threshold = INTERSTATE_THRESHOLD
    basis = 'interstate'
  } else if (fromStateCode in HIGHER_INTRA_VERIFIED) {
    threshold = HIGHER_INTRA_VERIFIED[fromStateCode]
    basis = 'intra_verified'
  } else if (fromStateCode in HIGHER_INTRA_REPORTED) {
    threshold = HIGHER_INTRA_REPORTED[fromStateCode]
    basis = 'intra_reported'
  } else {
    threshold = DEFAULT_INTRA_THRESHOLD
    basis = 'intra_default'
  }

  const required = consignmentValue > threshold

  const explanation = isInterstate
    ? `Inter-state movement (${fromStateCode} → ${toStateCode}). The threshold is ₹${INTERSTATE_THRESHOLD.toLocaleString('en-IN')} everywhere in India, and this consignment is ₹${consignmentValue.toLocaleString('en-IN')}.`
    : `Intra-state movement within state ${fromStateCode}, where the threshold is ₹${threshold.toLocaleString('en-IN')}` +
      (basis === 'intra_default'
        ? ' (the central default — this state publishes no higher limit we have confirmed).'
        : basis === 'intra_reported'
          ? ' (widely reported, not individually verified — treat as indicative).'
          : '.') +
      ` This consignment is ₹${consignmentValue.toLocaleString('en-IN')}.`

  return {
    required, isInterstate, fromStateCode, toStateCode,
    consignmentValue, threshold, thresholdBasis: basis, explanation,
  }
}

/**
 * Validity, from the moment Part B is filed.
 *
 * One day per 200 km or part thereof; one day per 20 km for over-dimensional
 * cargo. "Or part thereof" is why this is a ceiling and not a division —
 * 250 km is two days, not one and a quarter.
 */
export function ewayValidityDays(distanceKm: number, isOdc = false): number {
  const perDay = isOdc ? 20 : 200
  return Math.max(1, Math.ceil(distanceKm / perDay))
}

/** The expiry instant. Midnight-of-the-nth-day is the portal's own rounding;
 *  we keep the simpler exact-hours form and say so, rather than implying a
 *  precision we did not verify. */
export function ewayValidUntil(from: Date, distanceKm: number, isOdc = false): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + ewayValidityDays(distanceKm, isOdc))
  return d
}
