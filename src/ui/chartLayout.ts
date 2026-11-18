import { dateLabel, datePosition } from '../data/analyze'
import type { ChartType, Datum, Granularity } from '../data/analyze'
import { formatValue } from '../data/model'
import type { Column } from '../data/model'

export type ChartSpec = {
  data: Datum[]
  type: ChartType
  period?: Granularity
  metric?: Column
  title: string
}

export const chartColors = {
  ink: '#19211e', muted: '#4d5f55', green: '#2b795c', bar: '#468769',
  grid: '#e2eae3', zero: '#b8c8bc', fill: '#dceddf', negative: '#9d7055', partial: '#8c672f',
}

export function groupLabel(key: Datum['key'], period?: Granularity, full = false) {
  if (key === null) return 'Missing data'
  if (period) return dateLabel(key, period, full)
  return key === 'Missing data' || key.startsWith('“') ? `“${key}”` : key
}

export function breakdownLayout(data: Datum[]) {
  const available = data.filter(point => point.value !== null)
  const visible = available.slice(0, 6)
  return { ...barLayout(visible), groups: available.length }
}

export function barLayout(data: Datum[]) {
  const min = Math.min(0, ...data.map(item => item.value ?? 0))
  const max = Math.max(0, ...data.map(item => item.value ?? 0))
  const span = max - min || 1
  return {
    zero: -min / span,
    bars: data.map(item => ({
      ...item, left: (Math.min(0, item.value ?? 0) - min) / span, width: Math.abs(item.value ?? 0) / span,
    })),
  }
}

const shorten = (text: string, chars: number) => {
  const letters = Array.from(text)
  return letters.length <= chars ? text : letters.slice(0, chars - 1).join('') + '…'
}

function scale(min: number, max: number, count: number) {
  if (min === max) return { min: 0, max: 1, values: [0, 1] }
  const target = (max - min) / count || Number.MIN_VALUE
  const power = 10 ** Math.floor(Math.log10(target)) || Number.MIN_VALUE
  const step = power * ([1, 2, 2.5, 5, 10].find(factor => factor * power >= target) ?? 10)
  const first = Math.floor(min / step)
  const last = Math.ceil(max / step)
  return { min: first * step, max: last * step, values: Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step) }
}

export function chartLayout({ data, period, type, metric }: ChartSpec, width: number, height: number) {
  const values = data.flatMap(datum => datum.value === null ? [] : [datum.value])
  const range = scale(Math.min(0, ...values), Math.max(0, ...values), height >= 300 ? 5 : 4)
  const labels = range.values.map(value => formatValue(value, metric, true))
  const left = Math.min(width * 0.32, Math.max(42, ...labels.map(label => label.length * 7 + 11)))
  const right = width - 14
  const top = 17
  const bottom = height - 34
  const span = Math.max(1, right - left)
  const y = (value: number) => top + (range.max - value) / (range.max - range.min) * (bottom - top)
  const slots = data.map((datum, index) => period && datum.key ? datePosition(datum.key, period) : index)
  const extent = Math.max(1, (slots.at(-1) ?? 0) - (slots[0] ?? 0))
  const barStep = span / (data.length <= 1 ? 1 : extent + 1)
  const barWidth = Math.max(1, Math.min(60, barStep * 0.67))
  const spansYears = data[0]?.key?.slice(0, 4) !== data.at(-1)?.key?.slice(0, 4)
  const compact = width < 560
  const shortDateRange = (period === 'day' && extent < 365) || (period === 'week' && extent < 52)
  const axisLabel = (key: Datum['key']) => {
    if (!period || !key) return groupLabel(key, period)
    if (!compact) return dateLabel(key, period, spansYears)
    const label = dateLabel(key, period)
    if (!spansYears || shortDateRange || period === 'quarter' || period === 'year') return label
    return `${label} ’${key.slice(2, 4)}`
  }
  const points = data.map((datum, index) => ({
    ...datum,
    x: data.length === 1 ? left + span / 2
      : type === 'bar' ? left + (slots[index] - slots[0] + 0.5) * barStep
        : left + (slots[index] - slots[0]) / extent * span,
    y: datum.value === null ? null : y(datum.value),
    label: axisLabel(datum.key),
  }))

  const segments: { x: number; y: number }[][] = []
  const partialEdges: { x: number; y: number }[][] = []
  points.forEach((point, index) => {
    if (point.y === null) return
    const previous = points[index - 1]
    if (!previous || previous.y === null || (period && slots[index] - slots[index - 1] > 1.01)) segments.push([])
    else if (previous.coverage?.partial || point.coverage?.partial) {
      partialEdges.push([{ x: previous.x, y: previous.y }, { x: point.x, y: point.y }])
      segments.push([])
    }
    segments.at(-1)!.push({ x: point.x, y: point.y })
  })
  const xLabels: { x: number; text: string; align: 'start' | 'middle' | 'end' }[] = []
  let previousEnd = -Infinity
  const labelMax = Math.max(8, Math.min(19, Math.floor(span / Math.max(2, Math.min(points.length, 6)) / 7)))
  const candidates = points.map((point, index) => {
    const text = period ? point.label : shorten(point.label, labelMax)
    const size = text.length * 7
    const align = type === 'line' && points.length > 1 && index === 0 ? 'start' as const
      : type === 'line' && points.length > 1 && index === points.length - 1 ? 'end' as const : 'middle' as const
    const x = Math.max(size / 2 + 3, Math.min(width - size / 2 - 3, point.x))
    const start = align === 'start' ? point.x : align === 'end' ? point.x - size : x - size / 2
    return { x: align === 'middle' ? x : point.x, text, align, start, end: start + size }
  })
  const lastDate = period && candidates.length > 1 ? candidates.at(-1) : undefined
  for (const [index, label] of candidates.entries()) {
    const { start, end } = label
    if (lastDate && index > 0 && label !== lastDate && end + 13 > lastDate.start) continue
    if (start < previousEnd + 13) continue
    previousEnd = end
    xLabels.push(label)
  }

  return {
    left, right, top, bottom, barWidth, points, segments, partialEdges, xLabels, hasValues: values.length > 0,
    zero: y(0), ticks: range.values.map((value, index) => ({ value, y: y(value), label: labels[index] })),
    hoverDistance: period ? Math.max(12, (type === 'bar' ? barStep : span / extent) / 2 + 3) : Infinity,
  }
}
