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
  grid: '#e2eae3', zero: '#b8c8bc', fill: '#dceddf', negative: '#9d7055',
}

export function groupLabel(key: Datum['key'], period?: Granularity, full = false) {
  return key === null ? '(Missing)' : period ? dateLabel(key, period, full) : key
}

export function breakdownLayout(data: Datum[]) {
  const available = data.filter(point => point.value !== null)
  const visible = available.slice(0, 6)
  const min = Math.min(0, ...visible.map(item => item.value!))
  const max = Math.max(0, ...visible.map(item => item.value!))
  const span = max - min || 1
  return {
    groups: available.length, zero: -min / span,
    bars: visible.map(item => ({
      ...item, left: (Math.min(0, item.value!) - min) / span, width: Math.abs(item.value!) / span,
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
  const longDates = new Set(data.map(datum => datum.key?.slice(0, 4))).size > 1
  const points = data.map((datum, index) => ({
    ...datum,
    x: data.length === 1 ? left + span / 2
      : type === 'bar' ? left + (slots[index] - slots[0] + 0.5) * barStep
        : left + (slots[index] - slots[0]) / extent * span,
    y: datum.value === null ? null : y(datum.value),
    label: groupLabel(datum.key, period, longDates),
  }))

  const segments: { x: number; y: number }[][] = []
  points.forEach((point, index) => {
    if (point.y === null) return
    if (!index || points[index - 1].y === null || (period && slots[index] - slots[index - 1] > 1.01)) segments.push([])
    segments.at(-1)!.push({ x: point.x, y: point.y })
  })
  const xLabels: { x: number; text: string; align: 'start' | 'middle' | 'end' }[] = []
  let previousEnd = -Infinity
  const labelMax = Math.max(8, Math.min(19, Math.floor(span / Math.max(2, Math.min(points.length, 6)) / 7)))
  for (const [index, point] of points.entries()) {
    const text = shorten(point.label, labelMax)
    const size = text.length * 7
    const align = type === 'line' && points.length > 1 && index === 0 ? 'start'
      : type === 'line' && points.length > 1 && index === points.length - 1 ? 'end' : 'middle'
    const x = Math.max(size / 2 + 3, Math.min(width - size / 2 - 3, point.x))
    const start = align === 'start' ? point.x : align === 'end' ? point.x - size : x - size / 2
    if (start < previousEnd + 13) continue
    previousEnd = start + size
    xLabels.push({ x: align === 'middle' ? x : point.x, text, align })
  }

  return {
    left, right, top, bottom, barWidth, points, segments, xLabels, hasValues: values.length > 0,
    zero: y(0), ticks: range.values.map((value, index) => ({ value, y: y(value), label: labels[index] })),
    hoverDistance: period ? Math.max(12, (type === 'bar' ? barStep : span / extent) / 2 + 3) : Infinity,
  }
}
