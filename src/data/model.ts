export const limits = {
  bytes: 15 * 1024 * 1024,
  workbookBytes: 120 * 1024 * 1024,
  rows: 100_000,
  columns: 100,
  cells: 1_000_000,
  cellLength: 32_767,
}

export function validateFile(name: string, size: number) {
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension !== 'csv' && extension !== 'tsv' && extension !== 'xlsx') {
    throw new Error('Choose a CSV, TSV, or .xlsx file. Older .xls workbooks can be saved as .xlsx or CSV.')
  }
  if (!size) throw new Error('This file is empty. Choose a spreadsheet with a header and at least one row.')
  if (size > limits.bytes) throw new Error('This file exceeds 15 MB. Export a smaller sheet or split the file, then try again.')
  return extension
}

export type Cell = string | number | boolean | null
export type SourceCell = Cell | { amount: number; unit: string; display: string }
export type Kind = 'category' | 'text' | 'identifier' | 'date' | 'number' | 'currency' | 'percent'
export type NumberStyle = 'auto' | 'dot' | 'comma'
export type DateOrder = 'auto' | 'mdy' | 'dmy'
export type Settings = { numberStyle: NumberStyle; dateOrder: DateOrder }
export const defaultSettings: Settings = { numberStyle: 'auto', dateOrder: 'auto' }

export const delimiterLabels = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' } as const
export type Delimiter = keyof typeof delimiterLabels

export type Source = {
  filename: string
  headers: string[]
  rows: SourceCell[][]
  notices: string[]
  sheet?: string
  sheets?: string[]
  dialect?: { delimiter: Delimiter; ambiguous: Delimiter[] }
}

export type Column = {
  index: number
  name: string
  kind: Kind
  unit?: string
  missing: number
  invalid: number
  note?: string
  numberStyle?: NumberStyle
  dateOrder?: DateOrder
  percentScale?: 'points' | 'fraction'
  allowUnmarked?: boolean
  excludedUnmarked?: number
}

export type SchemaEdit = { kind: Kind; unit?: string; percentScale?: 'points' | 'fraction'; assignUnmarked?: boolean }
export type Edits = Record<number, SchemaEdit>
export type Dataset = { columns: Column[]; rows: Cell[][] }

export const kinds: Record<Kind, string> = {
  category: 'Category',
  text: 'Text',
  identifier: 'Identifier',
  date: 'Date',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percentage',
}

export const currencies = ['$', ...Intl.supportedValuesOf('currency')]
export const isMeasure = (kind: Kind) => kind === 'number' || kind === 'currency' || kind === 'percent'
export const integer = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const valueFormats = new Map<string, Intl.NumberFormat>()

export function sourceValue(cell: SourceCell): Cell {
  return cell !== null && typeof cell === 'object' ? cell.display : cell
}

export function formatValue(value: Cell, column?: Column, compact = false): string {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value !== 'number') return value
  const currency = column?.kind === 'currency' ? column.unit : undefined
  const magnitude = Math.abs(value)
  const notation = magnitude > 0 && (magnitude < 1e-5 || magnitude >= 1e15) ? 'scientific' : compact ? 'compact' : 'standard'
  const scientificPercent = column?.kind === 'percent' && notation === 'scientific'
  const style = column?.kind === 'percent' && !scientificPercent ? 'percent' : currency && currency !== '$' ? 'currency' : 'decimal'
  const number = style === 'percent' ? value / 100 : value
  const digits = compact ? (magnitude < 1 ? 5 : 2) : (magnitude < 1 ? 6 : 4)
  const key = `${style}-${currency}-${notation}-${digits}`
  let formatter = valueFormats.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en', {
      style, currency, notation, maximumFractionDigits: digits,
    })
    valueFormats.set(key, formatter)
  }
  const formatted = formatter.format(number)
  if (scientificPercent) return formatted + '%'
  return column?.kind === 'currency' && column.unit === '$'
    ? (value < 0 ? `−$${formatted.slice(1)}` : `$${formatted}`)
    : formatted
}
