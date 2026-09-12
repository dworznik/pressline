/** Minor units (1360 EUR → "€13.60") for pages; the digit count comes from the currency itself, so JPY and friends are right. */
export const formatMoney = (amount: number, currency: string, locale = 'en'): string => {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
  return formatter.format(amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2))
}
