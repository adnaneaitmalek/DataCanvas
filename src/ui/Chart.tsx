import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { ChartNoAxesCombined } from 'lucide-react'
import { formatValue, integer } from '../data/model'
import { chartLayout, groupLabel } from './chartLayout'
import type { ChartSpec } from './chartLayout'

type Selection = { data: ChartSpec['data']; index: number; source: 'pointer' | 'keyboard' | 'touch' }

export function Chart({ data, type, period, metric, title, interactive = true }: ChartSpec & { interactive?: boolean }) {
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(680)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  const [selection, setSelection] = useState<Selection>()
  const areaId = useId()
  const hintId = useId()
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.max(200, Math.round(entry.contentRect.width)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!interactive) return
    const resize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [interactive])

  const heightLimit = width >= 640 ? Math.max(252, Math.min(392, viewportHeight - 585)) : 330
  const height = interactive ? Math.round(Math.min(heightLimit, Math.max(206, width * 0.3 + 120))) : width < 440 ? 210 : 268
  const layout = useMemo(() => chartLayout({ data, type, period, metric, title }, width, height), [data, type, period, metric, title, width, height])
  const { hasValues, points, left, right, top, bottom, zero } = layout
  const active = selection?.data === data ? selection : undefined
  const selected = active ? points[active.index] : undefined
  const tooltipWidth = Math.min(210, width - 12)

  function pick(event: PointerEvent<HTMLDivElement>, source: 'pointer' | 'touch') {
    if (!interactive || !hasValues || (event.pointerType === 'touch' && source === 'pointer')) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    let index = 0
    points.forEach((point, i) => {
      if (Math.abs(point.x - x) < Math.abs(points[index].x - x)) index = i
    })
    if (x < left - 9 || x > right + 9 || y < top - 9 || y > bottom + 5 || Math.abs(points[index].x - x) > layout.hoverDistance) {
      if (active?.source === source) setSelection(undefined)
      return
    }
    if (active?.index === index && active.source === source) {
      if (source === 'touch') setSelection(undefined)
    } else {
      setSelection({ index, data, source })
    }
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      if (active) event.stopPropagation()
      setSelection(undefined)
    }
    const current = active?.index ?? -1
    const next = { ArrowLeft: current < 0 ? data.length - 1 : current - 1, ArrowRight: current + 1, Home: 0, End: data.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setSelection({ index: Math.max(0, Math.min(data.length - 1, next)), data, source: 'keyboard' })
  }

  const caption = selected ? groupLabel(selected.key, period, true) : ''
  const value = selected ? formatValue(selected.value, metric) : ''
  const records = selected
    ? `${integer.format(selected.records)} ${selected.records === 1 ? 'record' : 'records'}${selected.records !== selected.valid ? ` · ${integer.format(selected.valid)} with values` : ''}` : ''

  return <div className={`chart-frame${hasValues ? '' : ' chart-empty'}`} ref={frame}
    tabIndex={interactive && hasValues ? 0 : undefined} role={interactive ? 'group' : undefined}
    aria-label={interactive ? `${title} chart` : undefined}
    aria-describedby={interactive && hasValues ? hintId : undefined}
    onFocus={event => {
      if (hasValues && event.currentTarget.matches(':focus-visible')) setSelection({ data, index: 0, source: 'keyboard' })
    }}
    onBlur={() => setSelection(undefined)} onKeyDown={hasValues ? navigate : undefined}
    onPointerMove={event => pick(event, 'pointer')}
    onPointerUp={event => { if (event.pointerType === 'touch') pick(event, 'touch') }}
    onPointerLeave={() => { if (active?.source === 'pointer') setSelection(undefined) }}>
    {hasValues ? <>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} aria-hidden="true">
        <defs><linearGradient id={areaId} x2="0%" y2="100%"><stop stopColor="#78ba9e" stopOpacity=".3" /><stop offset="1" stopColor="#d7ede4" stopOpacity=".17" /></linearGradient></defs>
        {layout.ticks.map(tick => <g key={tick.value}>
          <line x1={left} x2={right} y1={tick.y} y2={tick.y} className={tick.value === 0 ? 'axis-zero' : 'axis-grid'} />
          <text x={left - 9} y={tick.y} dy=".34em" textAnchor="end">{tick.label}</text>
        </g>)}
        {selected && <line className="chart-cursor" x1={selected.x} x2={selected.x} y1={top} y2={bottom} />}
        {type === 'bar' ? points.map((point, index) => point.y !== null && <rect key={index} x={point.x - layout.barWidth / 2}
          y={Math.min(point.y, zero)} width={layout.barWidth} height={Math.max(0.8, Math.abs(zero - point.y))} rx="2"
          className={`chart-bar${selected === point ? ' is-selected' : ''}`} />)
          : layout.segments.map(segment => {
            const path = segment.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')
            return <g key={segment[0].x}>
              {segment.length > 1 && <path d={`${path} L${segment.at(-1)!.x},${zero} L${segment[0].x},${zero} Z`} fill={`url(#${areaId})`} />}
              <path d={path} className="chart-line" />
              {(points.length <= 15 || segment.length === 1) && segment.map(point => <circle key={point.x} cx={point.x} cy={point.y} r="3.5" className="chart-dot" />)}
            </g>
          })}
        {layout.xLabels.map((label, i) => <text key={i} x={label.x} y={height - 11} textAnchor={label.align}>{label.text}</text>)}
        {type === 'line' && selected && selected.y !== null && <circle className="chart-dot active-dot" cx={selected.x} cy={selected.y} r="5" />}
      </svg>
      {interactive && <>
        <span className="sr-only" id={hintId}>Use arrow keys, Home, and End to inspect values. Escape closes the tooltip.</span>
        <span aria-live="polite" className="sr-only">{active?.source === 'keyboard' && selected ? `${caption}. ${value}. ${records}.` : ''}</span>
        {selected && <div className="chart-tooltip" aria-hidden="true" style={{
          width: tooltipWidth,
          left: Math.max(5, selected.x + 13 + tooltipWidth <= width ? selected.x + 13 : selected.x - tooltipWidth - 13),
          top: Math.max(5, Math.min(height - 102, (selected.y ?? top) - 39)),
        }}>
          <span>{caption}</span><strong>{selected.value === null ? 'No valid values' : value}</strong><small>{records}</small>
        </div>}
      </>}
    </> : <><ChartNoAxesCombined size={25} aria-hidden="true" /><strong>No values to chart</strong><span>Adjust your filters, grouping, or metric.</span></>}
  </div>
}
