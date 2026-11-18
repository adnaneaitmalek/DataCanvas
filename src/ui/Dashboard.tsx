import { useDeferredValue, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowDown, ArrowDownUp, ArrowLeft, ArrowRight, ArrowUp, ChartColumn, ChartNoAxesCombined, ChevronLeft, ChevronRight,
  Database, Download, FileSpreadsheet, Grid2X2, Hash, Layers3, ListFilter, Search, Settings2, Table2, Upload, X,
} from 'lucide-react'
import {
  aggregations, chooseGranularity, dateLabel, defaultMetric, filterRows, groupRows, metricLabel, periods, recommendedAggregation, total,
} from '../data/analyze'
import type { Aggregation, ChartType, Datum, Filter, Granularity, Metric } from '../data/analyze'
import { chartCsv, csv, downloadCsv } from '../data/export'
import { formatValue, integer, isMeasure } from '../data/model'
import type { Cell, Column, Dataset, Source } from '../data/model'
import { loadSample } from '../data/samples'
import { Chart } from './Chart'
import { closePopover, Field, Popover, Select } from './shared'

const MAX_GROUPS = 12
const MAX_PERIODS = 36
const PAGE_SIZE = 25
const preferredSales = loadSample('sales')

function Stats({ dataset, rows, metric }: { dataset: Dataset; rows: Cell[][]; metric: Metric }) {
  const selected = metric.column === null ? undefined : dataset.columns[metric.column]
  const alternatives = dataset.columns.filter(column => isMeasure(column.kind) && column.index !== metric.column)
  const config: { metric: Metric; column?: Column; icon: typeof Hash }[] = [
    { metric, column: selected, icon: selected ? ChartNoAxesCombined : Database },
  ]
  if (selected) config.push({ metric: { column: null, aggregation: 'count' }, icon: Database })
  for (const column of alternatives.slice(0, 3 - config.length)) {
    config.push({ metric: { column: column.index, aggregation: recommendedAggregation(column) }, column, icon: Layers3 })
  }
  return <div className={`stats-grid${config.length === 3 ? ' stats-three' : ''}`} style={{ '--stat-count': config.length } as React.CSSProperties}>
    {config.map(({ metric, column, icon: Icon }) => {
      const result = total(rows, metric)
      const displayColumn = metric.aggregation === 'count' ? undefined : column
      return <article className="panel stat-card" key={column?.index ?? 'records'}>
        <div className="stat-label"><span>{metricLabel(metric, column)}</span><span className="stat-icon"><Icon size={16} /></span></div>
        <strong title={formatValue(result.value, displayColumn)}>{formatValue(result.value, displayColumn)}</strong>
        <span className="stat-context">{column ? `${integer.format(result.valid)} of ${integer.format(rows.length)} rows with values` : 'Rows in current view'}</span>
      </article>
    })}
  </div>
}

function Breakdown({ data, column, title }: { data: Datum[]; column?: Column; title: string }) {
  const available = data.filter(point => point.value !== null)
  const visible = available.slice(0, 6)
  const max = Math.max(0, ...visible.map(item => Math.abs(item.value ?? 0)))
  return <section className="panel breakdown">
    <div className="panel-heading"><div><h2>{title}</h2><p>{available.length > 6 ? `Top 6 of ${integer.format(available.length)} groups` : 'Category breakdown'}</p></div>
      <span className="stat-icon"><ChartColumn size={16} /></span></div>
    {visible.length ? <ul className="bars-list">
      {visible.map((item, index) => <li key={index}>
        <div><span title={item.key ?? '(Missing)'}>{item.key ?? '(Missing)'}</span><strong>{formatValue(item.value, column)}</strong></div>
        <div className="bar-track" aria-hidden="true"><span className={Number(item.value) < 0 ? 'negative' : ''} style={{ width: `${max ? Math.abs(Number(item.value)) / max * 100 : 0}%` }} /></div>
      </li>)}
    </ul> : <div className="breakdown-empty">No values in this view.</div>}
  </section>
}

export function DashboardPreview() {
  const { dataset } = preferredSales
  const metric = defaultMetric(dataset.columns)
  const column = dataset.columns[metric.column!]
  const trend = groupRows(dataset.rows, metric, dataset.columns[1], 'month').groups
  const regions = groupRows(dataset.rows, metric, dataset.columns[2], 'month').groups
  const rangeLabel = `${dateLabel(trend[0].key!, 'month')}–${dateLabel(trend.at(-1)!.key!, 'month', true)}`
  return <div className="preview-window" aria-label="Preview of the retail sales dashboard">
    <div className="preview-top"><span><Grid2X2 size={15} /> Workspace <ChevronRight size={13} /> <strong>Retail sales</strong></span>
      <span className="tag"><span className="status-dot" /> Sample data</span></div>
    <div className="preview-body">
      <div className="preview-heading"><div><h2>Retail sales</h2><p>Orders, revenue, and units sold across four regions.</p></div>
        <span className="preview-date"><FileSpreadsheet size={14} /> {rangeLabel}</span></div>
      <Stats dataset={dataset} rows={dataset.rows} metric={metric} />
      <div className="chart-grid">
        <section className="panel trend-panel"><div className="panel-heading"><div><h2>Revenue over time</h2><p>Sum of revenue by month</p></div><span className="stat-icon"><ChartNoAxesCombined size={16} /></span></div>
          <Chart data={trend} type="line" period="month" metric={column} title="Revenue over time" interactive={false} /></section>
        <Breakdown data={regions} column={column} title="Revenue by region" />
      </div>
    </div>
  </div>
}

function FilterEditor({ dataset, filters, onChange }: { dataset: Dataset; filters: Filter[]; onChange: (filters: Filter[]) => void }) {
  const first = dataset.columns.find(column => column.kind === 'category') ?? dataset.columns[0]
  const [draft, setDraft] = useState<Filter>({ column: first.index, value: '', min: '', max: '' })
  const [error, setError] = useState('')
  const column = dataset.columns[draft.column]
  const range = column.kind === 'date' || isMeasure(column.kind)
  const choices = useMemo(() => {
    if (column.kind !== 'category') return []
    const values = new Set<string>()
    for (const row of dataset.rows) {
      if (row[column.index] !== null) values.add(String(row[column.index]))
      if (values.size > 100) return undefined
    }
    return [...values].sort((a, b) => a.localeCompare(b))
  }, [dataset.rows, column])

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.missing && (range ? !draft.min && !draft.max : !draft.value.trim())) {
      setError(range ? 'Enter at least one bound.' : 'Choose or enter a value.')
      return
    }
    if (!draft.missing && range && draft.min && draft.max &&
      (column.kind === 'date' ? draft.min > draft.max : Number(draft.min) > Number(draft.max))) {
      setError('The lower bound must be at or below the upper bound.')
      return
    }
    onChange([...filters, { ...draft, value: column.kind === 'category' && choices ? draft.value : draft.value.trim() }])
    setDraft({ ...draft, min: '', max: '', value: '', missing: false })
    setError('')
    closePopover(event.currentTarget.closest('details'))
  }

  return <Popover className="filter-details" buttonClass="button secondary" label={<><ListFilter size={16} /> Filters {filters.length > 0 && <span className="filter-count">{filters.length}</span>}</>}>
      <form className="panel filter-editor" onSubmit={apply} onChange={() => setError('')}>
        <div className="filter-fields">
          <Field label="Filter column"><Select value={draft.column} onChange={event => setDraft({ column: Number(event.target.value), min: '', max: '', value: '' })}>
            {dataset.columns.map(column => <option key={column.index} value={column.index}>{column.name}</option>)}
          </Select></Field>
          {range ? <div className="range-fields">
            <Field label={column.kind === 'date' ? 'From date' : 'Minimum'}><input disabled={draft.missing} type={column.kind === 'date' ? 'date' : 'number'} step="any"
              value={draft.min} onChange={event => setDraft({ ...draft, min: event.target.value })} /></Field>
            <Field label={column.kind === 'date' ? 'To date' : 'Maximum'}><input disabled={draft.missing} type={column.kind === 'date' ? 'date' : 'number'} step="any"
              value={draft.max} onChange={event => setDraft({ ...draft, max: event.target.value })} /></Field>
          </div> : <Field label={column.kind === 'category' ? 'Equals' : 'Contains'}>
            {column.kind === 'category' && choices ? <Select disabled={draft.missing} value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })}>
              <option value="">Choose a value</option>{choices.map(option => <option key={option} value={option}>{option}</option>)}
            </Select> : <input disabled={draft.missing} value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })} placeholder="Enter a value" />}
          </Field>}
        </div>
        <label className="checkbox"><input type="checkbox" checked={Boolean(draft.missing)} onChange={event => setDraft({ ...draft, missing: event.target.checked })} /> Missing values only</label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="button primary" type="submit">Apply filter</button>
      </form>
  </Popover>
}

function FilterChips({ dataset, filters, onChange }: { dataset: Dataset; filters: Filter[]; onChange: (filters: Filter[]) => void }) {
  if (!filters.length) return null
  return <div className="filter-chips" aria-label="Active filters">
    {filters.map((filter, i) => {
      const name = dataset.columns[filter.column].name
      const condition = filter.missing ? 'Missing' : filter.value || (filter.min && filter.max ? `${filter.min} to ${filter.max}` : filter.min ? `≥ ${filter.min}` : `≤ ${filter.max}`)
      return <button className="filter-chip" type="button" key={i} onClick={() => onChange(filters.filter((_, index) => i !== index))} aria-label={`Remove filter ${name}: ${condition}`}>
        <span><strong>{name}</strong> · {condition}</span><X size={14} />
      </button>
    })}
    <button className="quiet-link" type="button" onClick={() => onChange([])}>Clear filters</button>
  </div>
}

function DataTable({ source, dataset, rows }: { source: Source; dataset: Dataset; rows: Cell[][] }) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ column: number; ascending: boolean }>()
  const [raw, setRaw] = useState(false)
  const collator = useMemo(() => new Intl.Collator('en', { numeric: true, sensitivity: 'base' }), [])
  const sourceIndex = useMemo(() => new Map(dataset.rows.map((row, index) => [row, index])), [dataset.rows])
  const displayed = (row: Cell[]) => raw ? source.rows[sourceIndex.get(row)!] : row
  const matched = useMemo(() => {
    const valueOf = (row: Cell[], i: number) => raw ? source.rows[sourceIndex.get(row)!][i] : row[i]
    const needle = deferredQuery.trim().toLowerCase()
    const result = needle ? rows.filter(row =>
      (raw ? source.rows[sourceIndex.get(row)!] : row).some((value, index) =>
        value !== null && (String(value).toLowerCase().includes(needle) || (!raw && typeof value === 'number' && formatValue(value, dataset.columns[index]).toLowerCase().includes(needle)))))
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
      <div><h2>Data table</h2><p>{integer.format(matched.length)} matching {matched.length === 1 ? 'row' : 'rows'}</p></div>
      <div className="table-tools">
        <label className="search-field"><Search size={16} /><input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }}
          type="search" aria-label="Search rows" placeholder="Search rows…" /></label>
        <label className="checkbox"><input type="checkbox" checked={raw} onChange={event => { setRaw(event.target.checked); setPage(0) }} /> Source values</label>
        <button className="button secondary" type="button" disabled={!matched.length || deferredQuery !== query} onClick={() => downloadCsv(`${base}-table`, csv(
          source.headers, matched.map(displayed),
        ))}><Download size={15} /> Export table</button>
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
          return <tr key={index}><td className="row-number">{integer.format(index + 1)}</td>{displayed(row).map((cell, i) =>
            <td key={i} className={cell === null ? 'quality-missing' : undefined}>
              <span title={cell === null ? 'Missing' : String(cell)}>{raw ? cell === null ? '—' : String(cell) : formatValue(cell, dataset.columns[i])}</span>
            </td>,
          )}</tr>
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

export function Dashboard({ source, dataset, title, sample }: { source: Source; dataset: Dataset; title: string; sample: boolean }) {
  const dates = dataset.columns.filter(column => column.kind === 'date' && column.invalid + column.missing < dataset.rows.length)
  const dimensions = dataset.columns.filter(column => column.kind === 'category')
  const measures = dataset.columns.filter(column => isMeasure(column.kind))
  const [metric, setMetric] = useState(() => defaultMetric(dataset.columns))
  const [groupIndex, setGroupIndex] = useState<number | null>(dates[0]?.index ?? dimensions[0]?.index ?? null)
  const [period, setPeriod] = useState<Granularity>(() => dates.length ? chooseGranularity(dataset.rows, dates[0].index) : 'month')
  const [chart, setChart] = useState<ChartType>(dates.length ? 'line' : 'bar')
  const [filters, setFilters] = useState<Filter[]>([])
  const [tab, setTab] = useState<'overview' | 'table'>('overview')
  const rows = useMemo(() => filterRows(dataset, filters), [dataset, filters])
  const metricColumn = metric.column === null ? undefined : dataset.columns[metric.column]
  const displayColumn = metric.aggregation === 'count' ? undefined : metricColumn
  const group = groupIndex === null ? undefined : dataset.columns[groupIndex]
  const dateGroup = group?.kind === 'date'
  const primary = useMemo(() => groupRows(rows, metric, group, period), [rows, metric, group, period])
  const category = dimensions.find(column => column.index !== groupIndex)
  const breakdown = useMemo(() => category ? groupRows(rows, metric, category, period).groups : [], [rows, metric, category, period])
  const shown = dateGroup ? primary.groups.slice(-MAX_PERIODS) : primary.groups.slice(0, MAX_GROUPS)
  const label = metricLabel(metric, metricColumn)
  const titleForChart = dateGroup ? `${label} over time` : group ? `${label} by ${group.name}` : label
  const fileBase = source.filename.replace(/\.[^.]+$/, '')
  const noticeParts = [
    primary.groups.length > shown.length ? `${dateGroup ? 'Latest' : 'Top'} ${shown.length} of ${integer.format(primary.groups.length)} ${dateGroup ? 'observed periods' : 'groups'}. Chart export includes every group.` : '',
    primary.excluded ? `${integer.format(primary.excluded)} rows without valid dates are excluded from this chart.` : '',
  ].filter(Boolean)

  function changeGroup(value: string) {
    const next = value === '' ? null : Number(value)
    const nextDate = next !== null && dataset.columns[next].kind === 'date'
    if (nextDate) setPeriod(chooseGranularity(dataset.rows, next))
    if (Boolean(nextDate) !== Boolean(dateGroup)) setChart(nextDate ? 'line' : 'bar')
    setGroupIndex(next)
  }

  return <main id="main" className="workspace">
    <a className="back-link" href="#/import"><ArrowLeft size={14} /> Import a spreadsheet</a>
    <div className="workspace-heading">
      <div><div className="heading-with-tag"><h1 tabIndex={-1}>{title}</h1>{sample && <span className="tag"><span className="status-dot" /> Sample data</span>}</div>
        <p className="dataset-meta"><FileSpreadsheet size={15} /> <span title={source.filename}>{source.filename}</span>{source.sheet && <><span>·</span><span title={source.sheet}>{source.sheet}</span></>}
          <span>·</span> {integer.format(source.rows.length)} rows <span>·</span> {source.headers.length} columns</p></div>
      <div className="workspace-actions">
        <a className="button secondary" href="#/review"><Settings2 size={16} /> Edit columns</a>
        <Popover className="export-menu" buttonClass="button primary" label={<><Download size={16} /> Export</>}>
          <div className="panel export-choices">
            <button type="button" disabled={!rows.length} onClick={event => {
              closePopover(event.currentTarget.closest('details'))
              const allowed = new Set(rows)
              downloadCsv(`${fileBase}-filtered`, csv(source.headers, source.rows.filter((_, i) => allowed.has(dataset.rows[i]))))
            }}><Table2 size={16} /> Filtered rows (CSV)</button>
            <button type="button" disabled={!primary.groups.length} onClick={event => {
              closePopover(event.currentTarget.closest('details'))
              downloadCsv(`${fileBase}-chart`, chartCsv(group?.name ?? 'Group', label, primary.groups, displayColumn?.kind === 'percent' ? '%' : displayColumn?.unit))
            }}><ChartColumn size={16} /> Chart values (CSV)</button>
          </div>
        </Popover>
      </div>
    </div>
    <div className="workspace-nav">
      <div className="view-tabs" aria-label="Workspace view">
        <button type="button" aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}><Grid2X2 size={16} /> Overview</button>
        <button type="button" aria-pressed={tab === 'table'} onClick={() => setTab('table')}><Table2 size={16} /> Data table</button>
      </div>
      <div className="view-tools"><span className="matches" aria-live="polite">{integer.format(rows.length)} of {integer.format(dataset.rows.length)} rows</span>
        <FilterEditor dataset={dataset} filters={filters} onChange={setFilters} /></div>
    </div>
    <FilterChips dataset={dataset} filters={filters} onChange={setFilters} />
    {tab === 'overview' ? <>
      <Stats dataset={dataset} rows={rows} metric={metric} />
      <div className={`chart-grid${category ? '' : ' single-chart'}`}>
        <section className="panel trend-panel" aria-labelledby="main-chart-title">
          <div className="panel-heading trend-heading">
            <div><h2 id="main-chart-title">{titleForChart}</h2><p>{metricColumn ? `${aggregations[metric.aggregation]} · ${metricColumn.name}` : 'Count of rows'}</p></div>
            <div className="chart-toggle" aria-label="Chart type">
              {dateGroup && <button type="button" aria-label="Line chart" aria-pressed={chart === 'line'} onClick={() => setChart('line')}><ChartNoAxesCombined size={17} /></button>}
              <button type="button" aria-label="Bar chart" aria-pressed={chart === 'bar'} onClick={() => setChart('bar')}><ChartColumn size={17} /></button>
            </div>
          </div>
          <div className="chart-controls">
            <Field label="Metric"><Select value={metric.column ?? ''} onChange={event => {
              const index = event.target.value
              setMetric(index === '' ? { column: null, aggregation: 'count' } : { column: Number(index), aggregation: recommendedAggregation(dataset.columns[Number(index)]) })
            }}><option value="">Records</option>{measures.map(column => <option key={column.index} value={column.index}>{column.name}</option>)}</Select></Field>
            {metricColumn && <Field label="Aggregation"><Select value={metric.aggregation} onChange={event => setMetric({ ...metric, aggregation: event.target.value as Aggregation })}>
              {Object.entries(aggregations).filter(([key]) => key !== 'sum' || metricColumn.kind !== 'percent').map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </Select></Field>}
            <Field label="Group by"><Select value={groupIndex ?? ''} onChange={event => changeGroup(event.target.value)}>
              <option value="">All records</option>{[...dates, ...dimensions].map(column => <option key={column.index} value={column.index}>{column.name}</option>)}
            </Select></Field>
            {dateGroup && <Field label="Date granularity"><Select value={period} onChange={event => setPeriod(event.target.value as Granularity)}>
              {Object.entries(periods).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </Select></Field>}
          </div>
          <Chart key={`${groupIndex}-${period}-${metric.column}-${metric.aggregation}-${filters.length}`} data={shown} type={chart} period={dateGroup ? period : undefined} metric={displayColumn} title={titleForChart} />
          {noticeParts.length > 0 && <p className="chart-note">{noticeParts.join(' ')}</p>}
        </section>
        {category && <Breakdown data={breakdown} column={displayColumn} title={`${label} by ${category.name}`} />}
      </div>
      <div className="workspace-foot"><span><Upload size={14} /> Processed locally in this tab</span>
        <button type="button" className="quiet-link" onClick={() => { setTab('table'); window.scrollTo({ top: 0 }) }}>Inspect data <ArrowRight size={15} /></button></div>
    </> : <DataTable source={source} dataset={dataset} rows={rows} />}
  </main>
}
