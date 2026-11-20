import { useDeferredValue, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { csv, downloadCsv, typedCsv } from '../data/export'
import type { TablePosition, TableState } from '../data/analysisState'
import { columnLabel } from '../data/currency'
import { formatValue, integer, isMeasure, sourceValue } from '../data/model'
import type { Cell, Dataset, Source } from '../data/model'
import { Field, Select } from './shared'

const PAGE_SIZE = 25

export interface TableExport {
  count: number
  pending: boolean
  download: () => void
}

function columnLeft(scroll: HTMLDivElement, name: string) {
  const row = scroll.querySelector<HTMLTableRowElement>('thead tr')
  const header = Array.from(row?.cells ?? []).find(cell => cell.dataset.column === name)
  if (!row || !header) return undefined
  return scroll.scrollLeft + header.getBoundingClientRect().left - scroll.getBoundingClientRect().left - row.cells[0].offsetWidth
}

export function DataTable({ source, dataset, rows, state, position, onChange, renderExport, onPositionChange }: {
  source: Source; dataset: Dataset; rows: Cell[][]; state: TableState; onChange: (patch: Partial<TableState>) => void
  position: TablePosition
  onPositionChange: () => void
  renderExport: (selection: TableExport) => ReactNode
}) {
  const { query, page, sort, raw } = state
  const scrollHint = useId()
  const scroller = useRef<HTMLDivElement>(null)
  const savePosition = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [jumpColumn, setJumpColumn] = useState(position.jump ?? '')
  const [overflows, setOverflows] = useState(false)
  const deferredQuery = useDeferredValue(query)
  const collator = useMemo(() => new Intl.Collator('en', { numeric: true, sensitivity: 'base' }), [])
  const sourceIndex = useMemo(() => new Map(dataset.rows.map((row, index) => [row, index])), [dataset.rows])
  const displayed = (row: Cell[]) => raw ? source.rows[sourceIndex.get(row)!].map(sourceValue) : row
  const matched = useMemo(() => {
    const valueOf = (row: Cell[], i: number) => raw ? sourceValue(source.rows[sourceIndex.get(row)!][i]) : row[i]
    const needle = deferredQuery.trim().toLowerCase()
    const result = needle ? rows.filter(row =>
      row.some((_, index) => {
        const value = valueOf(row, index)
        return value !== null && (String(value).toLowerCase().includes(needle) || (!raw && typeof value === 'number' && formatValue(value, dataset.columns[index]).toLowerCase().includes(needle)))
      }))
      : rows
    if (!sort) return result
    return [...result].sort((a, b) => {
      const left = valueOf(a, sort.column)
      const right = valueOf(b, sort.column)
      if (left === null) return right === null ? 0 : 1
      if (right === null) return -1
      const order = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right))
      return sort.ascending ? order : -order
    })
  }, [raw, source.rows, sourceIndex, deferredQuery, rows, dataset.columns, sort, collator])
  const lastPage = Math.max(0, Math.ceil(matched.length / PAGE_SIZE) - 1)
  const current = Math.min(lastPage, page)
  const start = current * PAGE_SIZE
  const base = source.filename.replace(/\.[^.]+$/, '')
  const label = (index: number) => raw ? dataset.columns[index].name : columnLabel(dataset.columns[index])

  useLayoutEffect(() => {
    const scroll = scroller.current
    const table = scroll?.querySelector('table')
    if (!scroll || !table) return
    const left = position.anchor === undefined ? undefined : columnLeft(scroll, position.anchor)
    const jump = position.jump === undefined ? undefined : columnLeft(scroll, position.jump)
    scroll.scrollLeft = left === undefined ? (jump ?? 0) : left + (position.offset ?? 0)
    const measure = () => setOverflows(scroll.scrollWidth > scroll.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    observer.observe(table)
    return () => observer.disconnect()
  }, [dataset.columns, position])

  function rememberPosition(scroll: HTMLDivElement) {
    const row = scroll.querySelector<HTMLTableRowElement>('thead tr')
    if (!row) return
    const firstVisible = scroll.getBoundingClientRect().left + row.cells[0].offsetWidth
    const cell = Array.from(row.cells).slice(1).find(header => header.getBoundingClientRect().right > firstVisible + 1)
    position.anchor = cell?.dataset.column
    position.offset = cell ? firstVisible - cell.getBoundingClientRect().left : 0
    clearTimeout(savePosition.current)
    savePosition.current = setTimeout(onPositionChange, 150)
  }

  useLayoutEffect(() => () => clearTimeout(savePosition.current), [])

  return <section className="panel table-panel" aria-label="Data table">
    <div className="panel-heading table-heading">
      <div><h2>Data table</h2><p aria-live="polite">{integer.format(matched.length)} matching {matched.length === 1 ? 'row' : 'rows'}</p></div>
      <div className="table-tools">
        <label className="search-field"><Search size={16} /><input value={query} onChange={event => onChange({ query: event.target.value, page: 0 })}
          type="search" aria-label="Search rows" placeholder="Search rows…" /></label>
        <label className="checkbox"><input type="checkbox" checked={raw} onChange={event => onChange({ raw: event.target.checked, page: 0 })} /> Source values</label>
        {renderExport({ count: matched.length, pending: deferredQuery !== query, download: () => {
          const output = raw ? csv(source.headers, matched.map(row => source.rows[sourceIndex.get(row)!])) : typedCsv(dataset.columns, matched)
          downloadCsv(`${base}-table`, output)
        } })}
      </div>
    </div>
    {overflows && <div className="table-navigation">
      <p className="table-scroll-hint" id={scrollHint}>Scroll sideways to see more columns. Use the arrow keys when the table is focused.</p>
      {dataset.columns.length > 7 && <Field label="Jump to column"><Select value={dataset.columns.some(column => column.name === jumpColumn) ? jumpColumn : ''} onChange={event => {
        const name = event.target.value
        setJumpColumn(name)
        position.jump = name
        const scroll = scroller.current
        const left = scroll ? columnLeft(scroll, name) : undefined
        if (scroll && left !== undefined) {
          scroll.scrollLeft = left
          rememberPosition(scroll)
        }
      }}>
        <option value="" disabled>Choose a column</option>
        {dataset.columns.map(column => <option key={column.index} value={column.name}>{label(column.index)}</option>)}
      </Select></Field>}
    </div>}
    <div className="table-scroll" ref={scroller} tabIndex={0} role="region" aria-label="Spreadsheet rows"
      aria-describedby={overflows ? scrollHint : undefined} onScroll={event => rememberPosition(event.currentTarget)}>
      <table className="data-table">
        <thead><tr><th scope="col" aria-label="Row number">#</th>{dataset.columns.map(column => {
          const active = sort?.column === column.index
          const SortIcon = active ? sort.ascending ? ArrowUp : ArrowDown : ArrowDownUp
          return <th key={column.index} scope="col" data-column={column.name} className={isMeasure(column.kind) ? 'numeric-cell' : undefined}
            aria-sort={active ? sort.ascending ? 'ascending' : 'descending' : undefined}>
            <button type="button" onClick={() => onChange({ sort: { column: column.index, ascending: !active || !sort.ascending }, page: 0 })}>
              <span title={label(column.index)}>{label(column.index)}</span><SortIcon size={13} />
            </button>
          </th>
        })}</tr></thead>
        <tbody>{matched.slice(start, start + PAGE_SIZE).map(row => {
          const index = sourceIndex.get(row)!
          return <tr key={index}><th scope="row" className="row-number">{integer.format(index + 1)}</th>{displayed(row).map((cell, i) => {
            const display = raw && cell !== null ? String(cell) : formatValue(cell, dataset.columns[i])
            const column = dataset.columns[i]
            const nowrap = column.kind === 'date' || isMeasure(column.kind)
            return <td key={i} className={[cell === null && 'quality-missing', nowrap && 'scalar-cell', isMeasure(column.kind) && 'numeric-cell'].filter(Boolean).join(' ')}>
              {display.length > 85 ? <details className="table-cell-details">
                <summary aria-label={`Read ${column.name} in row ${index + 1}`}><span>{display.slice(0, 82)}…</span><ChevronDown size={15} /></summary><p>{display}</p>
              </details> : <span title={cell === null ? 'Missing' : String(cell)}>{display}</span>}
            </td>
          })}</tr>
        })}</tbody>
      </table>
      {!matched.length && <p className="table-empty">No rows match your search and filters.</p>}
    </div>
    <div className="table-footer">
      <span>{matched.length ? `${integer.format(start + 1)}–${integer.format(Math.min(matched.length, start + PAGE_SIZE))} of ${integer.format(matched.length)} rows` : '0 rows'}</span>
      <div>
        <button type="button" className="button secondary icon-button" aria-label="Previous page" disabled={current === 0} onClick={() => onChange({ page: current - 1 })}><ChevronLeft size={17} /></button>
        <button type="button" className="button secondary icon-button" aria-label="Next page" disabled={current === lastPage} onClick={() => onChange({ page: current + 1 })}><ChevronRight size={17} /></button>
      </div>
    </div>
  </section>
}
