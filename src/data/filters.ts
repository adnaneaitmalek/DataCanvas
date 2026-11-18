import { parseDate, parseNumber } from './infer'
import { formatValue, isMeasure } from './model'
import type { Cell, Column, Dataset, Kind } from './model'

export type Operator = 'eq' | 'neq' | 'contains' | 'notContains' | 'startsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'missing' | 'present'
export type MatchMode = 'all' | 'any'
type Bound = string | number
export type Filter = { column: number; operator: Operator; value?: Bound; end?: Bound }
export type FilterDraft = { column: number; operator: Operator; value: string; end: string }
type Choice = readonly [Operator, string]
const presence: Choice[] = [['missing', 'Is missing'], ['present', 'Has a value']]
const equality: Choice[] = [['eq', 'Equals'], ['neq', 'Does not equal']]
const numeric: Choice[] = [
  ...equality, ['gt', 'Greater than'], ['gte', 'At least'], ['lt', 'Less than'], ['lte', 'At most'], ['between', 'Between'], ...presence,
]
const calendar: Choice[] = [
  ['eq', 'On'], ['neq', 'Is not on'], ['gt', 'After'], ['gte', 'On or after'], ['lt', 'Before'], ['lte', 'On or before'], ['between', 'Between'], ...presence,
]
const categories: Choice[] = [...equality, ...presence]
const text: Choice[] = [['contains', 'Contains'], ['notContains', 'Does not contain'], ['startsWith', 'Starts with'], ...equality, ...presence]

export function operatorsFor(kind: Kind) {
  if (kind === 'date') return calendar
  if (isMeasure(kind)) return numeric
  return kind === 'category' ? categories : text
}

export function initialDraft(column: Column): FilterDraft {
  return { column: column.index, operator: operatorsFor(column.kind)[0][0], value: '', end: '' }
}

export function parseFilter(draft: FilterDraft, column: Column): Filter {
  const { operator } = draft
  if (draft.column !== column.index || !operatorsFor(column.kind).some(([candidate]) => candidate === operator)) throw new Error('Choose a valid operator for this column.')
  if (operator === 'missing' || operator === 'present') return { column: draft.column, operator }
  const bound = (input: string): Bound => {
    const value = input.trim()
    if (!value) throw new Error(operator === 'between' ? 'Enter both bounds.' : 'Enter or choose a value.')
    if (column.kind === 'date') {
      const date = parseDate(value, 'auto')
      if (!date) throw new Error('Enter a valid date.')
      return date
    }
    if (isMeasure(column.kind)) {
      const number = parseNumber(value, 'dot')
      if (number === null) throw new Error('Enter a valid number using a decimal point.')
      return number
    }
    return value
  }
  const value = bound(draft.value)
  if (operator !== 'between') return { column: draft.column, operator, value }
  const end = bound(draft.end)
  if (value > end) throw new Error('The lower bound must be at or below the upper bound.')
  return { column: draft.column, operator, value, end }
}

export function filterDescription(filter: Filter, column: Column) {
  const format = (value?: Bound) => formatValue(value ?? null, column)
  const label = operatorsFor(column.kind).find(([operator]) => operator === filter.operator)?.[1].toLowerCase()
  if (filter.operator === 'missing' || filter.operator === 'present') return label
  if (filter.operator === 'between') return `between ${format(filter.value)} and ${format(filter.end)}`
  return `${label} ${format(filter.value)}`
}

function predicate(filter: Filter, column: Column): (row: Cell[]) => boolean {
  const { operator, value, end } = filter
  const normalize = (entry: Cell | undefined) => typeof entry === 'string' && column.kind !== 'category'
    ? entry.toLowerCase() : entry
  const bound = normalize(value)
  return row => {
    const cell = row[column.index]
    if (operator === 'missing') return cell === null
    if (operator === 'present') return cell !== null
    if (cell === null || typeof bound !== typeof cell) return false
    const entry = normalize(cell)
    switch (operator) {
      case 'eq': return entry === bound
      case 'neq': return entry !== bound
      case 'contains': return String(entry).includes(String(bound))
      case 'notContains': return !String(entry).includes(String(bound))
      case 'startsWith': return String(entry).startsWith(String(bound))
      case 'gt': return cell > value!
      case 'gte': return cell >= value!
      case 'lt': return cell < value!
      case 'lte': return cell <= value!
      case 'between': return cell >= value! && cell <= end!
    }
  }
}

export function filterRows(dataset: Dataset, filters: Filter[], mode: MatchMode = 'all') {
  if (!filters.length) return dataset.rows
  const checks = filters.map(filter => predicate(filter, dataset.columns[filter.column]))
  return dataset.rows.filter(row => mode === 'all'
    ? checks.every(check => check(row))
    : checks.some(check => check(row)))
}
