/** Currencies whose minor unit is not 1/100. Everything else is two decimals. */
const MINOR_DIGITS: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  HUF: 2,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

export const minorDigits = (currency: string) => MINOR_DIGITS[currency.toUpperCase()] ?? 2;

/** `"13.60"` in EUR → 1360. Providers quote decimals as strings; Pressline stores integers. */
export const toMinorUnits = (decimal: string | number, currency: string): number => {
  const n = typeof decimal === 'number' ? decimal : Number.parseFloat(decimal);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** minorDigits(currency));
};

/** 1360 in EUR → `"13.60"` (what Stripe and Printful want back). */
export const toDecimalString = (amount: number, currency: string): string =>
  (amount / 10 ** minorDigits(currency)).toFixed(minorDigits(currency));

/** Apply a percentage markup and round to a whole minor unit. */
export const withMarkup = (amount: number, percent: number) =>
  Math.round(amount * (1 + percent / 100));
