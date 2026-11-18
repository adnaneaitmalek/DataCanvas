import { currencies, defaultSettings } from './model'
import type { Cell, Column, Dataset, DateOrder, Edits, Kind, NumberStyle, Source } from './model'

const symbols: Record<string, string> = { '$': '$', '€': 'EUR', '£': 'GBP', '¥': '¥', '₹': 'INR', '₩': 'KRW', 'US$': 'USD', 'C$': 'CAD', 'A$': 'AUD', 'NZ$': 'NZD', 'R$': 'BRL' }
const currencyToken = new RegExp(`^(${currencies.slice(1).join('|')}|[A-Z]{1,2}\\$|[€£¥₹₩$])\\s*(.+)$|^(.+?)\\s*(${currencies.slice(1).join('|')}|[A-Z]{1,2}\\$|[€£¥₹₩$])$`, 'i')
const textMissing = /^(?:\s*|n\/a|null|#n\/a|—)$/i

export function cleanCell(value: Cell): Cell {
  return typeof value === 'string' ? (textMissing.test(value.trim()) ? null : value.trim()) : value
}

function moneyParts(value: string): { unit: string; amount: string } | undefined {
  const accounting = /^\(.*\)$/.test(value)
  const bare = accounting ? value.slice(1, -1).trim() : value
  const sign = /^[-−+]/.test(bare) ? bare[0] : ''
  const match = currencyToken.exec(sign ? bare.slice(1).trim() : bare)
  if (!match) return
  const token = (match[1] ?? match[4]).toUpperCase()
  const unit = symbols[token] ?? token
  if (unit !== '¥' && !currencies.includes(unit)) return
  const amount = (match[2] ?? match[3]).trim()
  return { unit, amount: `${accounting ? '-' : sign}${amount}` }
}

function explicitUnit(name: string): string | undefined {
  const code = name.toUpperCase().match(new RegExp(`\\b(${currencies.slice(1).join('|')})\\b`))
  return code?.[1] ?? (name.includes('€') ? 'EUR' : name.includes('£') ? 'GBP' : name.includes('$') ? '$' : undefined)
}

function unitsMatch(symbol: string, unit: string): boolean {
  return symbol === unit ||
    (symbol === '$' && ['USD', 'CAD', 'AUD', 'NZD', 'MXN'].includes(unit)) ||
    (symbol === '¥' && ['JPY', 'CNY'].includes(unit))
}

function numericText(value: string): string {
  return value.trim().replace(/^\((.+)\)$/, '-$1').replace(/\u2212/g, '-').replace(/[\u00a0\u202f]/g, ' ')
}

export function parseNumber(value: Cell, style: NumberStyle): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  let text = numericText(value)
  if (!/^[+-]?[\d., ']+(?:e[+-]?\d+)?$/i.test(text)) return null
  const exponent = text.match(/e[+-]?\d+$/i)?.[0] ?? ''
  if (exponent) text = text.slice(0, -exponent.length)
  if (/[' ]/.test(text)) {
    if (!/^[+-]?\d{1,3}(?: \d{3})+(?:[.,]\d+)?$|^[+-]?\d{1,3}(?:'\d{3})+(?:[.,]\d+)?$/.test(text)) return null
    text = text.replace(/[' ]/g, '')
  }
  if (style === 'auto') {
    if (text.includes('.') && text.includes(',')) {
      style = text.lastIndexOf('.') > text.lastIndexOf(',') ? 'dot' : 'comma'
    } else if (/^[+-]?[1-9]\d{0,2}[.,]\d{3}$/.test(text)) {
      return null
    } else if (text.includes(',')) {
      style = /^[-+]?\d{1,3}(?:,\d{3}){2,}$/.test(text) ? 'dot' : 'comma'
    } else {
      style = /^[-+]?\d{1,3}(?:\.\d{3}){2,}$/.test(text) ? 'comma' : 'dot'
    }
  }
  const valid = style === 'dot'
    ? /^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)$/
    : /^[+-]?(?:(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?|,\d+)$/
  if (!valid.test(text)) return null
  const result = Number((style === 'dot' ? text.replace(/,/g, '') : text.replace(/\./g, '').replace(',', '.')) + exponent)
  return Number.isFinite(result) ? result : null
}

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null
}

export function parseDate(value: Cell, order: DateOrder): string | null {
  if (typeof value !== 'string') return null
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i.exec(value)
  if (iso) {
    if (+iso[4] > 23 || +iso[5] > 59 || +iso[6] > 59) return null
    return validDate(+iso[1], +iso[2], +iso[3])
  }
  const local = /^(\d{1,2})([-./])(\d{1,2})\2(\d{4})$/.exec(value)
  if (!local) return null
  const a = +local[1]
  const b = +local[3]
  if (order === 'auto') {
    if (a === b) order = 'mdy'
    else if (a > 12 && b <= 12) order = 'dmy'
    else if (b > 12 && a <= 12) order = 'mdy'
    else return null
  }
  return validDate(+local[4], order === 'mdy' ? a : b, order === 'mdy' ? b : a)
}

function columnNumberStyle(values: Cell[], explicit: NumberStyle): NumberStyle {
  if (explicit !== 'auto') return explicit
  const evidence = new Set<NumberStyle>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = numericText((moneyParts(value)?.amount ?? value).replace(/%$/, '').trim())
    if (!/^[+-]?[\d., ']+$/.test(text)) continue
    const dot = parseNumber(text, 'dot') !== null
    const comma = parseNumber(text, 'comma') !== null
    if (dot !== comma) evidence.add(dot ? 'dot' : 'comma')
  }
  return evidence.size === 1 ? [...evidence][0] : 'auto'
}

function columnDateOrder(values: Cell[], explicit: DateOrder): DateOrder {
  if (explicit !== 'auto') return explicit
  const evidence = new Set<DateOrder>()
  for (const value of values) {
    const mdy = parseDate(value, 'mdy')
    const dmy = parseDate(value, 'dmy')
    if (Boolean(mdy) !== Boolean(dmy)) evidence.add(mdy ? 'mdy' : 'dmy')
  }
  return evidence.size === 1 ? [...evidence][0] : 'auto'
}

function mapValue(value: Cell, kind: Kind, unit: string | undefined, numberStyle: NumberStyle, order: DateOrder, fractional: boolean): Cell {
  if (value === null) return null
  if (kind === 'text' || kind === 'identifier' || kind === 'category') return String(value)
  if (kind === 'date') return parseDate(value, order)
  if (kind === 'currency' && typeof value === 'string') {
    const money = moneyParts(value)
    if (money && (!unit || !unitsMatch(money.unit, unit))) return null
    return parseNumber(money?.amount ?? value, numberStyle)
  }
  if (kind === 'percent') {
    const labeled = typeof value === 'string' && /%\s*\)?$/.test(value)
    const parsed = parseNumber(labeled ? String(value).replace(/\s*%/, '') : value, numberStyle)
    return parsed !== null && fractional && !labeled ? parsed * 100 : parsed
  }
  return parseNumber(value, numberStyle)
}

function infer(values: Cell[], name: string, style: NumberStyle, order: DateOrder): { kind: Kind; unit?: string; note?: string } {
  if (!values.length) return { kind: 'text' }
  if (/(^|[^a-z\d])(id|sku|zip|postal|postcode|phone|barcode|serial)([^a-z\d]|$)/i.test(name) ||
    /(?:Id|ID|Code|SKU)$/.test(name) ||
    values.filter(value => typeof value === 'string' && /^0\d+$/.test(value)).length >= values.length * 0.5) {
    return { kind: 'identifier' }
  }
  const fits = (matches: number) => matches > 0 && matches >= values.length * 0.8
  const dates = values.filter(value => parseDate(value, order) !== null).length
  const dateLike = values.filter(value => typeof value === 'string' && /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{4})/.test(value)).length
  if (fits(dates) || fits(dateLike)) return { kind: 'date' }
  const percentCells = values.filter(value => typeof value === 'string' && /%\s*\)?$/.test(value)).length
  if (percentCells === values.length || /%|\bpercent(?:age)?\b/i.test(name)) return { kind: 'percent' }
  const tokens = values.flatMap(value => typeof value === 'string' ? [moneyParts(value)?.unit].filter(Boolean) as string[] : [])
  const known = explicitUnit(name)
  const units = new Set(tokens)
  if (tokens.length && (known ? tokens.some(unit => !unitsMatch(unit, known)) : units.size > 1 || units.has('¥'))) {
    return { kind: 'text', note: 'Mixed or ambiguous currency units. Choose one currency to analyze compatible values.' }
  }
  if (known || fits(tokens.length)) return { kind: 'currency', unit: known ?? tokens[0] }
  const numberLike = values.filter(value => parseNumber(value, style) !== null ||
    (typeof value === 'string' && /^[+-]?[1-9]\d{0,2}[.,]\d{3}$/.test(value))).length
  if (fits(numberLike) && percentCells === 0) return { kind: 'number' }
  if (/\b(feedback|comments?|notes?|description|remarks?)\b/i.test(name)) return { kind: 'text' }
  const distinct = new Set(values).size
  const short = values.every(value => String(value).length <= 72)
  return { kind: short && (distinct <= 20 || distinct <= Math.min(100, values.length * 0.5)) ? 'category' : 'text' }
}

export function profile(source: Source, edits: Edits = {}, settings = defaultSettings): Dataset {
  const rows: Cell[][] = source.rows.map(() => [])
  const columns = source.headers.map((name, index): Column => {
    const raw = source.rows.map(row => cleanCell(row[index] ?? null))
    const nonempty = raw.filter(value => value !== null)
    const style = columnNumberStyle(nonempty, settings.numberStyle)
    const order = columnDateOrder(nonempty, settings.dateOrder)
    const guess = infer(nonempty, name, style, order)
    const kind = edits[index]?.kind ?? guess.kind
    const unit = kind === 'currency' ? (edits[index]?.unit ?? guess.unit ?? '$') : undefined
    let invalid = 0
    raw.forEach((value, rowIndex) => {
      const typed = mapValue(value, kind, unit, style, order, edits[index]?.percentScale === 'fraction')
      if (value !== null && typed === null) invalid++
      rows[rowIndex].push(typed)
    })
    return { index, name, kind, unit, missing: raw.length - nonempty.length, invalid, note: kind === 'text' ? guess.note : undefined }
  })
  return { columns, rows }
}

