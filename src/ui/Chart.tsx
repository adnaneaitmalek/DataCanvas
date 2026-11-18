import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { ChartNoAxesCombined } from 'lucide-react'
import { dateLabel, datePosition } from '../data/analyze'
import type { ChartType, Datum, Granularity } from '../data/analyze'
import { formatValue, integer } from '../data/model'
import type { Column } from '../data/model'

const LEFT = 62
const RIGHT = 19
const TOP = 15
const BOTTOM = 35

function axis(min: number, max: number) {
  const target = (max / 4 - min / 4) || 1
  const factor = 10 ** Math.max(-300, Math.floor(Math.log10(target)))
  const step = ([1, 2, 2.5, 5, 10].find(value => value >= target / factor) ?? 1) * factor
  const floor = Math.floor(min / step) * step
  const ceiling = Math.ceil(max / step) * step || (min < 0 ? 0 : step)
  const ticks = Array.from({ length: Math.min(8, Math.round((ceiling - floor) / step) + 1) }, (_, i) => floor + i * step)
  return { low: floor, high: ceiling, ticks }
}

export function Chart({ data, type, period, metric, title, interactive = true }: {
  data: Datum[]; type: ChartType; period?: Granularity; metric?: Column; title: string; interactive?: boolean
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(680)
  const [active, setActive] = useState<number | null>(null)
  const areaId = useId()
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const height = width < 440 ? 214 : 268
  const plotWidth = width - LEFT - RIGHT
  const plotHeight = height - TOP - BOTTOM
  const values = data.flatMap(point => point.value === null ? [] : [point.value])
  const { low, high, ticks } = axis(Math.min(0, ...values), Math.max(0, ...values))
  const y = (value: number) => TOP + (high - value) / (high - low || 1) * plotHeight
  const slots = data.map((d, i) => period && d.key ? datePosition(d.key, period) : i)
  const extent = Math.max(1, (slots.at(-1) ?? 0) - (slots[0] ?? 0))
  const barStep = plotWidth / (period ? extent + 1 : Math.max(1, data.length))
  const pointX = (i: number) => {
    if (data.length === 1) return LEFT + plotWidth / 2
    if (type === 'bar') return LEFT + barStep * ((period ? slots[i] - slots[0] : i) + 0.5)
    return LEFT + ((slots[i] - slots[0]) / extent) * plotWidth
  }
  const points = data.map((datum, i) => ({ ...datum, x: pointX(i), y: datum.value === null ? null : y(datum.value) }))
  const segments: { x: number; y: number }[][] = []
  points.forEach((point, i) => {
    if (point.y === null) return
    if (i === 0 || points[i - 1].y === null || (period && slots[i] - slots[i - 1] > 1.01)) segments.push([])
    segments.at(-1)?.push({ x: point.x, y: point.y })
  })
  const selected = active === null ? undefined : points[active]
  const label = (key: string | null, full = false) => key === null ? '(Missing)' : period ? dateLabel(key, period, full) : key
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / (period ? 73 : 100)))))
  const years = new Set(data.map(d => d.key?.slice(0, 4)))
  const barWidth = Math.max(1, Math.min(56, barStep * 0.62))

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!interactive) return
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left
    let nearest = 0
    points.forEach((point, i) => {
      if (Math.abs(point.x - x) < Math.abs(points[nearest].x - x)) nearest = i
    })
    setActive(nearest)
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const index = active ?? 0
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: data.length - 1 }[event.key]
    if (next === undefined) {
      if (event.key === 'Escape') setActive(null)
      return
    }
    event.preventDefault()
    setActive(Math.max(0, Math.min(data.length - 1, next)))
  }

  return <div className={`chart-frame${values.length ? '' : ' chart-empty'}`} ref={frame}
    tabIndex={interactive && values.length ? 0 : undefined}
    role={interactive ? 'group' : undefined}
    aria-label={interactive ? `${title} chart. Use left and right arrow keys to inspect values.` : undefined}
    onFocus={() => { if (values.length) setActive(0) }} onBlur={() => setActive(null)}
    onKeyDown={navigate} onPointerMove={values.length ? move : undefined} onPointerDown={values.length ? move : undefined}
    onPointerLeave={event => { if (event.currentTarget !== document.activeElement) setActive(null) }}>
    {values.length ? <>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} aria-hidden="true">
        <defs><linearGradient id={areaId} x2="0%" y2="100%"><stop stopColor="#78ba9e" stopOpacity=".27" /><stop offset="1" stopColor="#d7ede4" stopOpacity=".24" /></linearGradient></defs>
        {ticks.map(tick => <g key={tick}>
          <line x1={LEFT} x2={width - RIGHT} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'axis-zero' : 'axis-grid'} />
          <text x={LEFT - 10} y={y(tick)} dy=".34em" textAnchor="end">{formatValue(tick, metric, true)}</text>
        </g>)}
        {type === 'bar' ? points.map((point, index) => point.y !== null && <rect key={index} x={point.x - barWidth / 2}
          y={Math.min(point.y, y(0))} width={barWidth} height={Math.max(1, Math.abs(y(0) - point.y))} rx="3" className="chart-bar" />)
          : segments.map(segment => {
            const path = segment.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')
            return <g key={segment[0].x}>
              {segment.length > 1 && <path d={`${path} L${segment.at(-1)?.x},${y(0)} L${segment[0].x},${y(0)} Z`} fill={`url(#${areaId})`} />}
              <path d={path} className="chart-line" />
              {(points.length <= 12 || segment.length === 1) && segment.map(point => <circle key={point.x} cx={point.x} cy={point.y} r="3.5" className="chart-dot" />)}
            </g>
          })}
        {points.map((point, i) => i % labelEvery === 0 && <text key={i} x={point.x} y={height - 10} textAnchor="middle">
          {period ? label(point.key, years.size > 1 && period === 'month') : label(point.key).length > 13 ? `${label(point.key).slice(0, 11)}…` : label(point.key)}
        </text>)}
        {selected && <g>
          <line className="chart-cursor" x1={selected.x} x2={selected.x} y1={TOP} y2={height - BOTTOM} />
          {selected.y !== null && <circle className="chart-dot active-dot" cx={selected.x} cy={selected.y} r="5" />}
        </g>}
      </svg>
      {interactive && <div className="chart-announcement" aria-live="polite">
        {selected && <div className="chart-tooltip" style={{ left: Math.max(4, Math.min(width - 184, selected.x + 12)) }}>
          <span>{label(selected.key, true)}</span><strong>{formatValue(selected.value, metric)}</strong>
          <small>{integer.format(selected.records)} records{selected.records !== selected.valid ? ` · ${integer.format(selected.valid)} valid` : ''}</small>
        </div>}
      </div>}
    </> : <><ChartNoAxesCombined size={25} aria-hidden="true" /><strong>No values to chart</strong><span>Adjust your filters, grouping, or metric.</span></>}
  </div>
}
