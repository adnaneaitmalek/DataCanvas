import { downloadFile } from '../data/export'
import { formatValue } from '../data/model'
import type { Datum } from '../data/analyze'
import { breakdownLayout, chartColors, chartLayout } from './chartLayout'
import type { ChartSpec } from './chartLayout'
import { imagePdf } from './pdfImage'

export type Stat = { key: string | number; label: string; value: string; context: string }
export type Report = {
  title: string
  detail: string
  filters: string
  stats: Stat[]
  chart: ChartSpec
  note: string
  breakdown?: { title: string; data: Datum[] }
}

const background = '#f7f8f5'
const white = '#fff'
const border = '#dee7df'
const { muted, ink, green, bar, zero, fill, grid, negative } = chartColors
const font = '"Geist Variable", Arial, sans-serif'

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 12)
  ctx.fillStyle = white
  ctx.fill()
  ctx.strokeStyle = border
  ctx.stroke()
}

function drawChart(ctx: CanvasRenderingContext2D, chart: ChartSpec, width: number, height: number) {
  const plot = chartLayout(chart, width, height)
  ctx.font = `12px ${font}`
  ctx.fillStyle = muted
  if (!plot.hasValues) {
    ctx.fillText('No values to chart', 30, height / 2)
    return
  }
  ctx.textAlign = 'right'
  for (const tick of plot.ticks) {
    ctx.strokeStyle = tick.value === 0 ? zero : grid
    ctx.beginPath()
    ctx.moveTo(plot.left, tick.y)
    ctx.lineTo(plot.right, tick.y)
    ctx.stroke()
    ctx.fillText(tick.label, plot.left - 9, tick.y + 4)
  }
  for (const label of plot.xLabels) {
    ctx.textAlign = label.align === 'middle' ? 'center' : label.align
    ctx.fillText(label.text, label.x, height - 11)
  }
  ctx.textAlign = 'left'
  if (chart.type === 'bar') {
    ctx.fillStyle = bar
    for (const point of plot.points) {
      if (point.y !== null) ctx.fillRect(point.x - plot.barWidth / 2, Math.min(point.y, plot.zero), plot.barWidth, Math.max(0.8, Math.abs(plot.zero - point.y)))
    }
    return
  }
  for (const segment of plot.segments) {
    const first = segment[0]
    ctx.beginPath()
    segment.forEach(({ x, y }, i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
    ctx.strokeStyle = green
    ctx.lineWidth = 2.25
    ctx.stroke()
    if (segment.length > 1) {
      ctx.lineTo(segment.at(-1)!.x, plot.zero)
      ctx.lineTo(first.x, plot.zero)
      ctx.closePath()
      ctx.fillStyle = fill + '80'
      ctx.fill()
    }
    ctx.fillStyle = green
    for (const { x, y } of segment) {
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.lineWidth = 1
}

function reportCanvas(report: Report) {
  const canvas = document.createElement('canvas')
  const width = 1240
  const height = 780
  const margin = 34
  canvas.width = width * 2
  canvas.height = height * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser could not create the dashboard image.')
  ctx.scale(2, 2)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  const text = (value: string, x: number, y: number, size: number, color: string, maxWidth: number, weight = 500) => {
    ctx.font = `${weight} ${size}px ${font}`
    ctx.fillStyle = color
    if (ctx.measureText(value).width > maxWidth) {
      const estimate = Math.max(1, Math.floor(value.length * maxWidth / ctx.measureText(value).width) - 2)
      value = value.slice(0, estimate)
      while (value && ctx.measureText(value + '…').width > maxWidth) value = value.slice(0, -1)
      value += '…'
    }
    ctx.fillText(value, x, y)
  }

  text('DataCanvas', margin, 47, 17, green, 200, 720)
  text(report.title, margin, 94, 37, ink, width - margin * 2, 730)
  text(report.detail, margin, 124, 15, muted, width - margin * 2)
  text(report.filters, margin, 150, 14, muted, width - margin * 2)

  const usable = width - margin * 2
  const cardWidth = (usable - (report.stats.length - 1) * 14) / report.stats.length
  report.stats.forEach((stat, i) => {
    const x = margin + i * (cardWidth + 14)
    box(ctx, x, 175, cardWidth, 105)
    text(stat.label, x + 17, 202, 14, muted, cardWidth - 34, 600)
    text(stat.value, x + 17, 239, 30, ink, cardWidth - 34, 740)
    text(stat.context, x + 17, 262, 12, muted, cardWidth - 34)
  })

  const chartWidth = report.breakdown ? 810 : usable
  box(ctx, margin, 296, chartWidth, 428)
  text(report.chart.title, margin + 18, 331, 19, ink, chartWidth - 36, 680)
  ctx.save()
  ctx.translate(margin + 12, 348)
  drawChart(ctx, report.chart, chartWidth - 24, 353)
  ctx.restore()
  if (report.breakdown) {
    const x = margin + chartWidth + 14
    const w = usable - chartWidth - 14
    const ranked = breakdownLayout(report.breakdown.data)
    box(ctx, x, 296, w, 428)
    text(report.breakdown.title, x + 17, 331, 18, ink, w - 34, 670)
    text(ranked.groups ? `${ranked.bars.length} of ${ranked.groups} groups` : 'No values in this view', x + 17, 354, 13, muted, w - 34)
    ranked.bars.forEach((point, index) => {
      const y = 384 + index * 49
      ctx.font = `600 13px ${font}`
      const value = formatValue(point.value, report.chart.metric)
      const labelWidth = Math.min(w * 0.48, ctx.measureText(value).width + 8)
      text(point.key ?? '(Missing)', x + 17, y, 13, muted, w - 51 - labelWidth)
      text(value, x + w - 17 - labelWidth, y, 13, ink, labelWidth, 600)
      ctx.fillStyle = grid
      ctx.fillRect(x + 17, y + 9, w - 34, 6)
      ctx.fillStyle = point.value! < 0 ? negative : bar
      ctx.fillRect(x + 17 + point.left * (w - 34), y + 9, point.width * (w - 34), 6)
    })
  }
  if (report.note) text(report.note, margin, 751, 13, muted, usable)
  return canvas
}

export async function downloadReport(name: string, type: 'png' | 'pdf', report: Report) {
  await document.fonts.ready
  const canvas = reportCanvas(report)
  const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => {
    if (result) resolve(result)
    else reject(new Error('The browser could not encode the dashboard image.'))
  }, type === 'png' ? 'image/png' : 'image/jpeg', 0.95))
  const blob = type === 'png' ? image : imagePdf(new Uint8Array(await image.arrayBuffer()), canvas.width, canvas.height)
  downloadFile(name, type, blob)
}
