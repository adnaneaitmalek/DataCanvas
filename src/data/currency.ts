import { currencies } from './model'

const symbols: Record<string, string> = {
  '$': '$', '€': 'EUR', '£': 'GBP', '¥': '¥', '₹': 'INR', '₩': 'KRW', '₽': 'RUB', '₺': 'TRY',
  '₪': 'ILS', '₱': 'PHP', '฿': 'THB', '₫': 'VND', '₴': 'UAH', '₦': 'NGN', 'US$': 'USD',
  'C$': 'CAD', 'CA$': 'CAD', 'A$': 'AUD', 'AU$': 'AUD', 'NZ$': 'NZD', 'R$': 'BRL', 'HK$': 'HKD', 'NT$': 'TWD', 'S$': 'SGD', 'MX$': 'MXN',
}
const codes = new Set(currencies)
const glyph = /[€£¥₹₩₽₺₪₱฿₫₴₦$]/
const prefix = /^([A-Z]{1,3}\$|[A-Z]{3}|[€£¥₹₩₽₺₪₱฿₫₴₦$])\s*(?=[+\-−.,\p{Nd}])/iu
const suffix = /([A-Z]{1,3}\$|[A-Z]{3}|[€£¥₹₩₽₺₪₱฿₫₴₦$])$/iu

export function currencyUnit(token: string): string | undefined {
  const normalized = token.toUpperCase()
  return symbols[normalized] ?? (codes.has(normalized) ? normalized : undefined)
}

export function headerUnit(name: string) {
  const explicit = /(?:^|\(|\[)([A-Z]{3})(?:$|\)|\])/i.exec(name)?.[1]
    ?? (/\b(amount|revenue|sales|expense|spend|price|cost|total|balance|payment)\b/i.test(name)
      ? name.match(/\b[A-Z]{3}\b/g)?.find(token => currencyUnit(token) && token !== 'ALL') : undefined)
  if (explicit && currencyUnit(explicit)) return currencyUnit(explicit)
  return currencyUnit(name.match(/[A-Za-z]{1,3}\$|[€£¥₹₩₽₺₪₱฿₫₴₦$]/)?.[0] ?? name.match(glyph)?.[0] ?? '')
}

export function currencyParts(value: string) {
  const accounting = /^\(.*\)$/.test(value)
  let bare = accounting ? value.slice(1, -1).trim() : value.trim()
  const negative = /^[-−]/.test(bare)
  if (/^[-−+]/.test(bare)) bare = bare.slice(1).trimStart()
  const start = prefix.exec(bare)
  const end = start ? null : suffix.exec(bare)
  const unit = currencyUnit(start?.[1] ?? end?.[1] ?? '')
  if (!unit) return
  const amount = (start ? bare.slice(start[0].length) : bare.slice(0, end?.index)).trim()
  if (!/^[+\-−.,\p{Nd}]/u.test(amount)) return
  if ((accounting || negative) && /^[+\-−]/.test(amount)) return
  return { unit, amount: (accounting || negative ? '-' : '') + amount }
}

export function unitsMatch(symbol: string, unit: string): boolean {
  return symbol === unit ||
    (symbol === '$' && ['USD', 'CAD', 'AUD', 'NZD', 'MXN', 'HKD', 'SGD', 'TWD'].includes(unit)) ||
    (symbol === '¥' && ['JPY', 'CNY'].includes(unit))
}
