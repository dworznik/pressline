import { Schema } from 'effect'

/** Currencies whose minor unit is not 1/100 (Stripe's zero-decimal list plus the three-decimal ones). */
const MINOR_DIGITS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  MGA: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  ISK: 0,
  BHD: 3,
  JOD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
}

/** A provider's decimal amount as a string, e.g. `"13.60"`; anything else is a provider bug, not free shipping. */
export const DecimalString = Schema.String.pipe(
  Schema.pattern(/^-?\d+(\.\d+)?$/, { message: () => 'expected a decimal amount like "13.60"' }),
)

export const minorDigits = (currency: string) => MINOR_DIGITS[currency.toUpperCase()] ?? 2

/** `"13.60"` in EUR → 1360. Providers quote decimals as strings; Pressline stores integers. */
export const toMinorUnits = (decimal: string, currency: string): number =>
  Math.round(Number.parseFloat(decimal) * 10 ** minorDigits(currency))

/** 1360 in EUR → `"13.60"` (what Stripe and Printful want back). */
export const toDecimalString = (amount: number, currency: string): string =>
  (amount / 10 ** minorDigits(currency)).toFixed(minorDigits(currency))

/** Apply a percentage markup and round to a whole minor unit. */
export const withMarkup = (amount: number, percent: number) =>
  Math.round(amount * (1 + percent / 100))
