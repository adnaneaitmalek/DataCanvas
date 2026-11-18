import { isMeasure } from './model'
import type { Cell, Column } from './model'

export type Aggregation = 'count' | 'sum' | 'average' | 'min' | 'max'
export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type ChartType = 'line' | 'bar'
export type Metric = { column: number | null; aggregation: Aggregation }
export type Datum = { key: string | null; value: number | null; records: number; valid: number }

export const aggregations: Record<Aggregation, string> = { count: 'Count', sum: 'Sum', average: 'Average', min: 'Minimum', max: 'Maximum' }
export const periods: Record<Granularity, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' }

export function recommendedAggregation(column: Column): Aggregation {
  const name = column.name.replace(/([a-z])([A-Z])/g, '$1 $2')
  if (column.kind === 'percent' || /\b(avg|average|rate|price|unit cost|cost per|per|score|rating|ratio|balance|index)\b/i.test(name)) return 'average'
  return /\b(revenue|sales|expenses?|amount|spend|units sold|orders|quantity|units on hand|stock|sessions|clicks|impressions|conversions|pageviews|page views|charges|fees|refunds|downloads)\b/i.test(name)
    ? 'sum' : 'average'
}

export function defaultMetric(columns: Column[], rowCount = Infinity): Metric {
  const measures = columns.filter(column => isMeasure(column.kind) && column.missing + column.invalid < rowCount)
  const preferred = measures.find(column => /\b(revenue|sales|amount|expenses?|sessions|stock|satisfaction)\b/i.test(column.name))
    ?? measures[0]
  return preferred ? { column: preferred.index, aggregation: recommendedAggregation(preferred) }
    : { column: null, aggregation: 'count' }
}

export function metricLabel(metric: Metric, column?: Column) {
  if (!column) return 'Records'
  const labels: Record<Aggregation, string> = { count: 'Count of', sum: 'Total', average: 'Avg.', min: 'Min.', max: 'Max.' }
  const label = column.name.replace(/\s*\((?:[A-Z]{3}|[$€£%])\)\s*$/, '') || column.name
  return `${labels[metric.aggregation]} ${label.replace(/^[A-Z](?=[a-z])/, letter => letter.toLowerCase())}`
}

export function partitionDate(date: string, period: Granularity): string {
  if (period === 'day') return date
  if (period === 'year') return `${date.slice(0, 4)}-01-01`
  if (period === 'month') return `${date.slice(0, 7)}-01`
  if (period === 'quarter') {
    const start = (Math.ceil(Number(date.slice(5, 7)) / 3) - 1) * 3 + 1
    return `${date.slice(0, 4)}-${String(start).padStart(2, '0')}-01`
  }
  const monday = new Date(`${date}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return monday.toISOString().slice(0, 10)
}

const dateFormats = {
  month: new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }),
  monthYear: new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  day: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  dayYear: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
}

export function dateLabel(key: string, period: Granularity, full = false): string {
  if (period === 'year') return key.slice(0, 4)
  if (period === 'quarter') return `Q${Math.ceil(Number(key.slice(5, 7)) / 3)} ${key.slice(0, 4)}`
  const formatter = period === 'month' ? (full ? dateFormats.monthYear : dateFormats.month) : (full ? dateFormats.dayYear : dateFormats.day)
  return formatter.format(new Date(`${key}T00:00:00Z`))
}

export function chooseGranularity(rows: Cell[][], column: number): Granularity {
  let first = ''
  let last = ''
  for (const row of rows) {
    const date = row[column]
    if (typeof date !== 'string') continue
    if (!first || date < first) first = date
    if (!last || date > last) last = date
  }
  const span = (Date.parse(last) - Date.parse(first)) / 86_400_000
  if (span > 365 * 8) return 'year'
  if (span > 900) return 'quarter'
  if (span > 150) return 'month'
  if (span > 35) return 'week'
  return 'day'
}

type Stats = { records: number; valid: number; sum: number; correction: number; min: number; max: number }
const emptyStats = (): Stats => ({ records: 0, valid: 0, sum: 0, correction: 0, min: Infinity, max: -Infinity })

function add(stats: Stats, row: Cell[], metric: Metric) {
  stats.records++
  const value = metric.column === null ? 1 : row[metric.column]
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  stats.valid++
  // Neumaier summation keeps small values when larger positive and negative values cancel.
  const next = stats.sum + value
  stats.correction += Math.abs(stats.sum) >= Math.abs(value) ? (stats.sum - next) + value : (value - next) + stats.sum
  stats.sum = next
  stats.min = Math.min(stats.min, value)
  stats.max = Math.max(stats.max, value)
}

function summarize(stats: Stats, metric: Metric, key: Datum['key']): Datum {
  const values = {
    count: stats.valid,
    sum: stats.sum + stats.correction,
    average: (stats.sum + stats.correction) / stats.valid,
    min: stats.min,
    max: stats.max,
  }
  const value = values[metric.aggregation]
  return {
    key,
    value: (stats.valid || metric.aggregation === 'count') && Number.isFinite(value) ? value : null,
    records: stats.records,
    valid: stats.valid,
  }
}

export function total(rows: Cell[][], metric: Metric): Datum {
  const stats = emptyStats()
  for (const row of rows) add(stats, row, metric)
  return summarize(stats, metric, null)
}

export function groupRows(rows: Cell[][], metric: Metric, group: Column | undefined, period: Granularity) {
  const buckets = new Map<string | null, Stats>()
  const partitions = new Map<string, string>()
  let excluded = 0
  for (const row of rows) {
    const cell = group ? row[group.index] : 'All records'
    if (group?.kind === 'date' && typeof cell !== 'string') {
      excluded++
      continue
    }
    let key = cell === null ? null : String(cell)
    if (group?.kind === 'date' && key !== null) {
      const date = key
      key = partitions.get(date) ?? partitionDate(date, period)
      partitions.set(date, key)
    }
    let stats = buckets.get(key)
    if (!stats) {
      stats = emptyStats()
      buckets.set(key, stats)
    }
    add(stats, row, metric)
  }
  const groups = [...buckets].map(([key, stats]) => summarize(stats, metric, key))
  groups.sort(group?.kind === 'date'
    ? (a, b) => a.key! < b.key! ? -1 : a.key! > b.key! ? 1 : 0
    : (a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || String(a.key).localeCompare(String(b.key)))
  return { groups, excluded }
}

export function datePosition(key: string, period: Granularity): number {
  if (period === 'month' || period === 'quarter' || period === 'year') {
    const month = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1
    return month / (period === 'year' ? 12 : period === 'quarter' ? 3 : 1)
  }
  return Date.parse(key) / (period === 'week' ? 604_800_000 : 86_400_000)
}
