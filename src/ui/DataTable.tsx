import { useDeferredValue, useMemo, useState } from 'react'
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react'
import { csv, downloadCsv, typedCsv } from '../data/export'
import { formatValue, integer, sourceValue } from '../data/model'
import type { Cell, Dataset, Source } from '../data/model'

const PAGE_SIZE = 25

export function DataTable({ source, dataset, rows }: { source: Source; dataset: Dataset; rows: Cell[][] }) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ column: number; ascending: boolean }>()
  const [raw, setRaw] = useState(false)
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

  return <section className="panel table-panel" aria-label="Data table">
    <div className="panel-heading table-heading">
      <div><h2>Data table</h2><p aria-live="polite">{integer.format(matched.length)} matching {matched.length === 1 ? 'row' : 'rows'}</p></div>
      <div className="table-tools">
        <label className="search-field"><Search size={16} /><input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }}
          type="search" aria-label="Search rows" placeholder="Search rows…" /></label>
        <label className="checkbox"><input type="checkbox" checked={raw} onChange={event => { setRaw(event.target.checked); setPage(0) }} /> Source values</label>
        <button className="button secondary" type="button" disabled={!matched.length || deferredQuery !== query} onClick={() => {
          const output = raw ? csv(source.headers, matched.map(row => source.rows[sourceIndex.get(row)!])) : typedCsv(dataset.columns, matched)
          downloadCsv(`${base}-table`, output)
        }}><Download size={15} /> Export table</button>
      </div>
    </div>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Spreadsheet rows">
      <table className="data-table">
        <thead><tr><th scope="col">#</th>{dataset.columns.map(column => {
          const active = sort?.column === column.index
          const SortIcon = active ? sort.ascending ? ArrowUp : ArrowDown : ArrowDownUp
          return <th key={column.index} scope="col" aria-sort={active ? sort.ascending ? 'ascending' : 'descending' : undefined}>
            <button type="button" onClick={() => { setSort({ column: column.index, ascending: !active || !sort.ascending }); setPage(0) }}>
              {column.name}<SortIcon size={13} />
            </button>
          </th>
        })}</tr></thead>
        <tbody>{matched.slice(start, start + PAGE_SIZE).map(row => {
          const index = sourceIndex.get(row)!
          return <tr key={index}><td className="row-number">{integer.format(index + 1)}</td>{displayed(row).map((cell, i) => {
            const display = raw && cell !== null ? String(cell) : formatValue(cell, dataset.columns[i])
            return <td key={i} className={cell === null ? 'quality-missing' : undefined}>
              {display.length > 85 ? <details className="table-cell-details">
                <summary aria-label={`Read ${dataset.columns[i].name} in row ${index + 1}`}>{display.slice(0, 82)}…</summary><p>{display}</p>
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
        <button type="button" className="button secondary icon-button" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft size={17} /></button>
        <button type="button" className="button secondary icon-button" aria-label="Next page" disabled={current === lastPage} onClick={() => setPage(current + 1)}><ChevronRight size={17} /></button>
      </div>
    </div>
  </section>
}
