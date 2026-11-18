import { currencyParts, headerUnit, resolveMarker } from './currency'
import { defaultSettings, sourceValue } from './model'
import type { Cell, Column, Dataset, DateOrder, Edits, Kind, NumberStyle, Source, SourceCell } from './model'

const textMissing = /^(?:\s*|n\/a|null|#n\/a|—)$/i
const percentMarker = /[%٪]\s*\)?$/
const ambiguousNumber = /^[+-]?[1-9]\d{0,2}[.,]\d{3}$/
const numericFormats = {
  dot: /^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d+)?|\.\d+)$/,
  comma: /^[+-]?(?:(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?|,\d+)$/,
}

function cleanCell(value: SourceCell): SourceCell {
  if (typeof value !== 'string') return value
  const clean = value.trim()
  return textMissing.test(clean) ? null : clean
}

function numericText(value: string): string {
  return value.trim().replace(/^\(\s*(.+?)\s*\)$/, '-$1').replace(/\u2212/g, '-')
    .replace(/[\u00a0\u202f\u066c]/g, ' ').replace(/\u066b/g, '.')
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) & 15))
}

function usableNumber(value: number) {
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null
}

export function parseNumber(value: Cell, style: NumberStyle): number | null {
  if (typeof value === 'number') return usableNumber(value)
  if (typeof value !== 'string') return null
  let text = numericText(value)
  if (!/^[+-]?[\d., ']+(?:e[+-]?\d+)?$/i.test(text)) return null
  const exponent = text.match(/e[+-]?\d+$/i)?.[0] ?? ''
  if (exponent) text = text.slice(0, -exponent.length)
  const separated = /[' ]/.test(text)
  if (separated) {
    if (!/^[+-]?\d{1,3}(?: \d{3})+(?:[.,]\d+)?$|^[+-]?\d{1,3}(?:'\d{3})+(?:[.,]\d+)?$/.test(text)) return null
    text = text.replace(/[' ]/g, '')
  }
  if (value.includes('٫')) style = 'dot'
  if (style === 'auto') {
    if (!separated && ambiguousNumber.test(text)) return null
    const dot = numericFormats.dot.test(text)
    const comma = numericFormats.comma.test(text)
    if (dot && comma && /[.,]/.test(text)) {
      if (text.includes(',')) style = 'comma'
      else style = 'dot'
    } else {
      style = dot ? 'dot' : 'comma'
    }
  }
  if (!numericFormats[style].test(text)) return null
  if (separated && text.includes(style === 'dot' ? ',' : '.')) return null
  const result = Number((style === 'dot' ? text.replace(/,/g, '') : text.replace(/\./g, '').replace(',', '.')) + exponent)
  return result === 0 && /[1-9]/.test(text) ? null : usableNumber(result)
}

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null
}

const isoDate = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/i
const localDate = /^(\d{1,2})([-./])(\d{1,2})\2(\d{4})$/
const months = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ')

export function parseDate(value: Cell, order: DateOrder): string | null {
  if (typeof value !== 'string') return null
  const iso = isoDate.exec(value)
  if (iso) {
    if (+iso[5] > 23 || +iso[6] > 59 || +iso[7] > 59 || +iso[8] > 23 || +iso[9] > 59) return null
    return validDate(+iso[1], +iso[3], +iso[4])
  }
  const words = /^(?:(\d{1,2})[ -]([a-z]{3})[ -]|([a-z]{3}) (\d{1,2}),? )(\d{4})$/i.exec(value)
  if (words) return validDate(+words[5], months.indexOf((words[2] ?? words[3]).toLowerCase()) + 1, +(words[1] ?? words[4]))
  const local = localDate.exec(value)
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

function columnNumberStyle(values: SourceCell[], explicit: NumberStyle): NumberStyle {
  if (explicit !== 'auto') return explicit
  const evidence = new Set<NumberStyle>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    if (value.includes('٫')) continue
    const text = (currencyParts(value)?.amount ?? value).replace(/[%٪]/, '').trim()
    if (!/[.,]/.test(text)) continue
    const dot = parseNumber(text, 'dot') !== null
    const comma = parseNumber(text, 'comma') !== null
    if (dot !== comma) evidence.add(dot ? 'dot' : 'comma')
    if (evidence.size > 1) return 'auto'
  }
  return evidence.size === 1 ? [...evidence][0] : 'auto'
}

function columnDateOrder(values: SourceCell[], explicit: DateOrder): DateOrder {
  if (explicit !== 'auto') return explicit
  const evidence = new Set<DateOrder>()
  for (const value of values) {
    if (typeof value !== 'string' || !localDate.test(value)) continue
    const mdy = parseDate(value, 'mdy')
    const dmy = parseDate(value, 'dmy')
    if (Boolean(mdy) !== Boolean(dmy)) evidence.add(mdy ? 'mdy' : 'dmy')
    if (evidence.size > 1) return 'auto'
  }
  return evidence.size === 1 ? [...evidence][0] : 'auto'
}

function marker(value: SourceCell) {
  if (value && typeof value === 'object') return value.unit === '%' ? undefined : value.unit
  return typeof value === 'string' ? currencyParts(value)?.unit : undefined
}

function mapValue(value: SourceCell, column: Column, declared?: string): Cell {
  const { kind, unit, numberStyle = 'auto', dateOrder = 'auto', percentScale, allowUnmarked } = column
  if (value === null) return null
  if (kind === 'text' || kind === 'identifier' || kind === 'category') return String(sourceValue(value))
  if (typeof value === 'object') {
    if (kind === 'currency' && resolveMarker(value.unit, declared ?? unit) === unit || kind === 'percent' && value.unit === '%') return usableNumber(value.amount)
    return null
  }
  if (kind === 'date') return parseDate(value, dateOrder)
  if (kind === 'currency') {
    const money = typeof value === 'string' ? currencyParts(value) : undefined
    if (money ? resolveMarker(money.unit, declared ?? unit) !== unit : !allowUnmarked) return null
    return parseNumber(money?.amount ?? value, numberStyle)
  }
  if (kind === 'percent') {
    const labeled = typeof value === 'string' && percentMarker.test(value)
    const parsed = parseNumber(labeled ? String(value).replace(/\s*[%٪]/, '') : value, numberStyle)
    return parsed !== null && percentScale === 'fraction' && !labeled ? usableNumber(parsed * 100) : parsed
  }
  return parseNumber(value, numberStyle)
}

function infer(values: SourceCell[], name: string, style: NumberStyle, order: DateOrder): { kind: Kind; unit?: string; note?: string } {
  if (!values.length) return { kind: 'text' }
  if (/(^|[^a-z\d])(id|sku|zip|postal|postcode|phone|barcode|serial)([^a-z\d]|$)/i.test(name) ||
    /(?:Id|ID|Code|SKU)$/.test(name) ||
    values.filter(value => typeof value === 'string' && /^(?:0\d+|\d{16,})$/.test(value) &&
      (value.startsWith('0') || !Number.isSafeInteger(Number(value)))).length >= values.length * 0.5) {
    return { kind: 'identifier' }
  }
  const fits = (matches: number) => matches > 0 && matches >= values.length * 0.8
  let dates = 0
  let percentCells = 0
  let currencyCells = 0
  let numbers = 0
  const units = new Set<string>()
  for (const value of values) {
    if (typeof value === 'string' && (isoDate.test(value) || localDate.test(value) || parseDate(value, order) !== null)) dates++
    if (typeof value === 'string' && percentMarker.test(value) || value && typeof value === 'object' && value.unit === '%') { percentCells++; continue }
    const unit = value && typeof value === 'object' ? value.unit : typeof value === 'string' ? currencyParts(value)?.unit : undefined
    if (unit) { currencyCells++; units.add(unit); continue }
    if ((value === null || typeof value !== 'object') && (parseNumber(value, style) !== null ||
      typeof value === 'string' && ambiguousNumber.test(value))) numbers++
  }
  if (fits(dates)) return { kind: 'date' }
  if (fits(percentCells) || /[%٪]|\bpercent(?:age)?\b/i.test(name)) return { kind: 'percent' }
  const known = headerUnit(name)
  if (known === '¥' || (known ? [...units].some(unit => resolveMarker(unit, known) !== known) : units.size > 1 || units.has('¥'))) {
    return { kind: 'text', note: 'Mixed or ambiguous currency units. Choose one currency to analyze compatible values.' }
  }
  if (known || fits(currencyCells)) return {
    kind: 'currency', unit: known ?? units.values().next().value,
    note: !known && currencyCells < values.length ? 'Amounts without a currency marker use the inferred unit.' : undefined,
  }
  if (fits(numbers) && !percentCells && !currencyCells) return { kind: 'number' }
  if (/\b(feedback|comments?|notes?|description|remarks?)\b/i.test(name)) return { kind: 'text' }
  const distinct = new Set(values.map(sourceValue)).size
  const short = values.every(value => String(sourceValue(value)).length <= 72)
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
    const declared = kind === 'currency' ? headerUnit(name) : undefined
    const allowUnmarked = kind !== 'currency' ? undefined : edits[index]?.assignUnmarked === true ||
      (declared ? resolveMarker(declared, unit) === unit && (declared === unit || declared !== '¥')
        : !nonempty.some(value => {
          const evidence = marker(value)
          return evidence !== undefined && resolveMarker(evidence, unit) !== unit
        }))
    const column: Column = {
      index, name, kind, unit, missing: raw.length - nonempty.length, invalid: 0, note: edits[index] ? undefined : guess.note,
      numberStyle: style, dateOrder: order, percentScale: kind === 'percent' ? edits[index]?.percentScale ?? 'points' : undefined,
      allowUnmarked,
    }
    raw.forEach((value, rowIndex) => {
      const typed = mapValue(value, column, declared && declared !== '$' && declared !== '¥' ? declared : undefined)
      if (value !== null && typed === null) {
        column.invalid++
        if (allowUnmarked === false && (typeof value === 'string' || typeof value === 'number') &&
          !marker(value) && parseNumber(value, style) !== null) column.excludedUnmarked = (column.excludedUnmarked ?? 0) + 1
      }
      rows[rowIndex].push(typed)
    })
    return column
  })
  return { columns, rows }
}

