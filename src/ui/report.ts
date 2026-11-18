import { downloadFile } from '../data/export'
import { coverageLabel, sparseCoverageNote } from '../data/analyze'
import { formatValue } from '../data/model'
import type { Datum } from '../data/analyze'
import { barLayout, breakdownLayout, chartColors, chartLayout, groupLabel } from './chartLayout'
import type { ChartSpec } from './chartLayout'
import { imagePdf } from './pdfImage'
import type { ImagePage } from './pdfImage'

export type Stat = { key: string | number; label: string; value: string; exact?: string; context: string }
export type Report = {
  title: string
  detail: string
  filters: { mode: 'all' | 'any'; conditions: string[] }
  stats: Stat[]
  chart?: ChartSpec
  note: string
  breakdown?: { title: string; data: Datum[]; metric: ChartSpec['metric'] }
}

const background = '#f7f8f5'
const white = '#fff'
const border = '#dee7df'
const { muted, ink, green, bar, zero, fill, grid, negative } = chartColors
const font = '"Geist Variable", Arial, sans-serif'
const width = 1240
const pageHeight = 780
const margin = 34
const lineHeight = 22
const usable = width - margin * 2

function conditionsHeading({ mode, conditions }: Report['filters']) {
  return conditions.length ? `Match ${mode} · ${conditions.length} ${conditions.length === 1 ? 'condition' : 'conditions'}` : 'No dashboard filters'
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 12)
  ctx.fillStyle = white
  ctx.fill()
  ctx.strokeStyle = border
  ctx.stroke()
}

function drawChart(ctx: CanvasRenderingContext2D, chart: ChartSpec, width: number, height: number) {
  if (!chart.period && chart.data.some(point => point.value !== null)) {
    const { bars, zero: origin } = barLayout(chart.data)
    const step = Math.min(43, height / bars.length)
    for (const [index, point] of bars.entries()) {
      const y = 15 + index * step
      ctx.font = `12px ${font}`
      ctx.fillStyle = ink
      ctx.fillText(groupLabel(point.key), 12, y, width - 145)
      ctx.textAlign = 'right'
      ctx.fillText(formatValue(point.value, chart.metric), width - 12, y, 120)
      ctx.textAlign = 'left'
      const span = width - 24
      ctx.fillStyle = grid
      ctx.fillRect(12, y + 6, span, 5)
      ctx.fillStyle = (point.value ?? 0) < 0 ? negative : bar
      ctx.fillRect(12 + span * point.left, y + 6, span * point.width, 5)
      if (origin > 0) { ctx.fillStyle = ink; ctx.fillRect(12 + span * origin, y + 6, 1, 5) }
    }
    return
  }
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
    for (const point of plot.points) {
      ctx.fillStyle = point.coverage?.partial ? chartColors.partial : bar
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
  ctx.strokeStyle = chartColors.partial
  ctx.setLineDash([5, 4])
  for (const [from, to] of plot.partialEdges) {
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }
  ctx.setLineDash([])
  for (const point of plot.points) {
    if (!point.coverage?.partial || point.y === null) continue
    ctx.beginPath()
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
    ctx.fillStyle = white
    ctx.fill()
    ctx.stroke()
  }
  ctx.lineWidth = 1
}

function makeCanvas(height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser could not create the dashboard image.')
  ctx.scale(2, 2)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)
  return { canvas, ctx }
}

function conditionLines(filters: Report['filters']) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser could not lay out the export.')
  ctx.font = `500 15px ${font}`
  const lines: string[] = []
  for (const [index, condition] of filters.conditions.entries()) {
    let line = `${index + 1}. `
    for (const word of condition.split(/(\s+)/)) {
      if (ctx.measureText(line + word).width <= usable) {
        line += word
      } else {
        if (line.trim()) lines.push(line.trimEnd())
        line = ''
        for (const char of word.trimStart()) {
          if (ctx.measureText(line + char).width > usable) { lines.push(line); line = '' }
          line += char
        }
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

function drawConditions(ctx: CanvasRenderingContext2D, report: Report, lines: string[], top: number, page?: number) {
  ctx.fillStyle = ink
  ctx.font = `700 23px ${font}`
  ctx.fillText(page ? `Applied conditions · part ${page}` : 'Applied conditions', margin, top)
  ctx.fillStyle = muted
  ctx.font = `500 15px ${font}`
  ctx.fillText(conditionsHeading(report.filters), margin, top + 27)
  lines.forEach((text, index) => ctx.fillText(text, margin, top + 55 + lineHeight * index))
}

function reportCanvas(report: Report, lines: string[]) {
  const height = lines.length ? pageHeight + 82 + lines.length * lineHeight : pageHeight
  if (height > 6000) throw new Error('This report exceeds one image. Choose the PDF or HTML report for every condition.')
  const { canvas, ctx } = makeCanvas(height)

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
  text(conditionsHeading(report.filters), margin, 150, 14, muted, width - margin * 2)

  const cardWidth = (usable - (report.stats.length - 1) * 14) / report.stats.length
  report.stats.forEach((stat, i) => {
    const x = margin + i * (cardWidth + 14)
    box(ctx, x, 175, cardWidth, 105)
    text(stat.label, x + 17, 202, 14, muted, cardWidth - 34, 600)
    text(stat.value, x + 17, 239, 30, ink, cardWidth - 34, 740)
    text(stat.context, x + 17, 262, 12, muted, cardWidth - 34)
  })

  const chartWidth = report.chart && report.breakdown ? 810 : usable
  if (report.chart) {
    const { data, period } = report.chart
    const partials = data.flatMap(point => point.coverage?.partial ? [point.coverage] : [])
    const sparse = sparseCoverageNote(data, period)
    box(ctx, margin, 296, chartWidth, 428)
    text(report.chart.title, margin + 18, 331, 19, ink, chartWidth - 36, 680)
    ctx.save()
    ctx.translate(margin + 12, 348)
    drawChart(ctx, report.chart, chartWidth - 24, partials.length || sparse ? 315 : 353)
    ctx.restore()
    partials.forEach((coverage, i) => text(`Partial ${period} · ${coverageLabel(coverage)}`,
      margin + 18, 681 + i * 18, 12, chartColors.partial, chartWidth - 36))
    if (sparse) text(sparse, margin + 18, 681 + partials.length * 18, 12, muted, chartWidth - 36)
  }
  if (report.breakdown) {
    const x = report.chart ? margin + chartWidth + 14 : margin
    const w = report.chart ? usable - chartWidth - 14 : usable
    const ranked = breakdownLayout(report.breakdown.data)
    box(ctx, x, 296, w, 428)
    text(report.breakdown.title, x + 17, 331, 18, ink, w - 34, 670)
    text(ranked.groups ? `${ranked.bars.length} of ${ranked.groups} groups` : 'No values in this view', x + 17, 354, 13, muted, w - 34)
    ranked.bars.forEach((point, index) => {
      const y = 384 + index * 49
      ctx.font = `600 13px ${font}`
      const value = formatValue(point.value, report.breakdown?.metric)
      const labelWidth = Math.min(w * 0.48, ctx.measureText(value).width + 8)
      text(groupLabel(point.key), x + 17, y, 13, muted, w - 51 - labelWidth)
      text(value, x + w - 17 - labelWidth, y, 13, ink, labelWidth, 600)
      ctx.fillStyle = grid
      ctx.fillRect(x + 17, y + 9, w - 34, 6)
      ctx.fillStyle = point.value! < 0 ? negative : bar
      ctx.fillRect(x + 17 + point.left * (w - 34), y + 9, point.width * (w - 34), 6)
    })
  }
  if (report.note) text(report.note, margin, report.chart || report.breakdown ? 751 : 319, 13, muted, usable)
  if (lines.length) drawConditions(ctx, report, lines, pageHeight + 15)
  return canvas
}

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function reportHtml(report: Report) {
  const table = (caption: string, rows: Datum[], metric: ChartSpec['metric'], period?: ChartSpec['period']) => `<table>
    <caption>${escape(caption)}</caption><thead><tr><th scope="col">Group</th><th scope="col">Value</th>
    <th scope="col">Records</th><th scope="col">Valid values</th>${period ? '<th scope="col">Observed dates</th>' : ''}</tr></thead><tbody>
    ${rows.map(row => `<tr><th scope="row">${escape(groupLabel(row.key, period, true))}</th>
      <td>${escape(formatValue(row.value, metric))}</td><td>${row.records}</td><td>${row.valid}</td>
      ${period ? `<td>${row.coverage ? escape(coverageLabel(row.coverage)) : '—'}</td>` : ''}</tr>`).join('')}</tbody></table>`
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape(report.title)} · DataCanvas</title>
    <style>body{font:1rem/1.55 system-ui,sans-serif;color:#19211e;background:#f7f8f5;margin:0;padding:1rem}
    main{max-width:65rem;margin:auto} h2{margin-top:2rem} dt,caption{font-weight:700}
    th,td{border:1px solid #ccd7ce;text-align:left;padding:.45rem} table{border-collapse:collapse;margin-bottom:1rem}
    caption{text-align:left} li,th{white-space:pre-wrap;overflow-wrap:anywhere}</style>
    <main><p>DataCanvas</p><h1>${escape(report.title)}</h1><p>${escape(report.detail)}</p>
    <h2>Applied conditions</h2><p>${escape(conditionsHeading(report.filters))}</p>
    ${report.filters.conditions.length ? `<ol>${report.filters.conditions.map(rule => `<li>${escape(rule)}</li>`).join('')}</ol>` : ''}
    <h2>Key metrics</h2><dl>${report.stats.map(stat => `<dt>${escape(stat.label)}</dt>
    <dd>${escape(stat.exact ?? stat.value)} · ${escape(stat.context)}</dd>`).join('')}</dl>
    ${report.chart ? `<h2>Chart values</h2>${table(report.chart.title, report.chart.data, report.chart.metric, report.chart.period)}` : ''}
    ${report.note ? `<p>${escape(report.note)}</p>` : ''}
    ${report.breakdown ? `<h2>Category breakdown</h2>${table(report.breakdown.title, breakdownLayout(report.breakdown.data).bars, report.breakdown.metric)}` : ''}
    </main></html>`
}

function encodeImage(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg') {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(result => {
    if (result) resolve(result)
    else reject(new Error('The browser could not encode the dashboard image.'))
  }, type, 0.95))
}

export async function downloadReport(name: string, type: 'png' | 'pdf' | 'html', report: Report) {
  if (type === 'html') {
    downloadFile(name, type, new Blob([reportHtml(report)], { type: 'text/html;charset=utf-8' }))
    return
  }
  await document.fonts.ready
  const lines = conditionLines(report.filters)
  if (type === 'png') {
    downloadFile(name, type, await encodeImage(reportCanvas(report, lines), 'image/png'))
    return
  }

  const pages: ImagePage[] = []
  const append = async (canvas: HTMLCanvasElement) => {
    const blob = await encodeImage(canvas, 'image/jpeg')
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height })
  }
  await append(reportCanvas(report, []))
  const capacity = Math.floor((pageHeight - 140) / lineHeight)
  for (let offset = 0; offset < lines.length; offset += capacity) {
    const { canvas, ctx } = makeCanvas(pageHeight)
    drawConditions(ctx, report, lines.slice(offset, offset + capacity), 53, lines.length > capacity ? offset / capacity + 1 : undefined)
    await append(canvas)
  }
  downloadFile(name, type, imagePdf(pages))
}
