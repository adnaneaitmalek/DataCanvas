import { useId, useMemo, useState } from 'react'
import {
  ChartColumn, ChartNoAxesCombined, ChevronRight, Download, FileSpreadsheet, FileText, Grid2X2, Image,
  Settings2, Table2, Upload,
} from 'lucide-react'
import {
  aggregations, chooseGranularity, dateLabel, defaultMetric, groupRows, metricLabel, periods, recommendedAggregation, total,
} from '../data/analyze'
import type { Aggregation, ChartType, Datum, Granularity, Metric } from '../data/analyze'
import { chartCsv, csv, downloadCsv } from '../data/export'
import { filterDescription, filterRows } from '../data/filters'
import type { Filter, MatchMode } from '../data/filters'
import { formatValue, integer, isMeasure } from '../data/model'
import type { Cell, Column, Dataset, Source } from '../data/model'
import { loadSample } from '../data/samples'
import { Chart } from './Chart'
import { breakdownLayout } from './chartLayout'
import type { ChartSpec } from './chartLayout'
import { DataTable } from './DataTable'
import { FilterButton, FilterPanel } from './FilterPanel'
import type { Report, Stat } from './report'
import { closePopover, Field, Popover, Select } from './shared'

const MAX_GROUPS = 12
const MAX_PERIODS = 36
const preferredSales = loadSample('sales')

function statCards(dataset: Dataset, rows: Cell[][], metric: Metric): Stat[] {
  const selected = metric.column === null ? undefined : dataset.columns[metric.column]
  const alternatives = dataset.columns.filter(column => isMeasure(column.kind) && column.index !== metric.column &&
    column.invalid + column.missing < dataset.rows.length)
  const metrics: Metric[] = [metric]
  if (selected) metrics.push({ column: null, aggregation: 'count' })
  for (const column of alternatives.slice(0, 3 - metrics.length)) {
    metrics.push({ column: column.index, aggregation: recommendedAggregation(column) })
  }
  return metrics.map(item => {
    const column = item.column === null ? undefined : dataset.columns[item.column]
    const result = total(rows, item)
    return {
      key: item.column ?? 'records', label: metricLabel(item, column),
      value: formatValue(result.value, item.aggregation === 'count' ? undefined : column),
      context: column
        ? `${integer.format(result.valid)} of ${integer.format(rows.length)} rows with values`
        : `Of ${integer.format(dataset.rows.length)} imported rows`,
    }
  })
}

function Stats({ cards }: { cards: Stat[] }) {
  return <div className={`stats-grid${cards.length === 3 ? ' stats-three' : ''}`} style={{ '--stat-count': cards.length } as React.CSSProperties}>
    {cards.map((card, index) => <article className={`panel stat-card${index === 0 ? ' featured-stat' : ''}`} key={card.key}>
      <div className="stat-label">{card.label}</div>
      <strong title={card.value}>{card.value}</strong>
      <span className="stat-context">{card.context}</span>
    </article>)}
  </div>
}

function Breakdown({ data, column, title }: { data: Datum[]; column?: Column; title: string }) {
  const { bars, groups, zero } = breakdownLayout(data)
  return <section className="panel breakdown">
    <div className="panel-heading"><div><h2>{title}</h2>
      <p>{groups > 6 ? `Top 6 of ${integer.format(groups)} groups` : `${integer.format(groups)} ${groups === 1 ? 'group' : 'groups'} with values`}</p>
    </div></div>
    {bars.length ? <ul className="bars-list">
      {bars.map((item, index) => <li key={index}>
        <div><span title={item.key ?? '(Missing)'}>{item.key ?? '(Missing)'}</span><strong>{formatValue(item.value, column)}</strong></div>
        <div className="bar-track" aria-hidden="true">
          <span className={`breakdown-bar${item.value! < 0 ? ' negative' : ''}`} style={{ left: `${item.left * 100}%`, width: `${item.width * 100}%` }} />
          {zero > 0 && zero < 1 && <span className="breakdown-zero" style={{ left: `${zero * 100}%` }} />}
        </div>
      </li>)}
    </ul> : <div className="breakdown-empty">No values in this view.</div>}
  </section>
}

export function DashboardPreview() {
  const { dataset } = preferredSales
  const metric = defaultMetric(dataset.columns, dataset.rows.length)
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
      <Stats cards={statCards(dataset, dataset.rows, metric)} />
      <div className="chart-grid">
        <section className="panel trend-panel"><div className="panel-heading"><div><h2>Revenue over time</h2><p>Sum of revenue by month</p></div></div>
          <Chart data={trend} type="line" period="month" metric={column} title="Revenue over time" interactive={false} /></section>
        <Breakdown data={regions} column={column} title="Revenue by region" />
      </div>
    </div>
  </div>
}

export function Dashboard({ source, dataset, title, sample }: { source: Source; dataset: Dataset; title: string; sample: boolean }) {
  const dates = dataset.columns.filter(column => column.kind === 'date' && column.invalid + column.missing < dataset.rows.length)
  const dimensions = dataset.columns.filter(column => column.kind === 'category')
  const measures = dataset.columns.filter(column => isMeasure(column.kind))
  const [metric, setMetric] = useState(() => defaultMetric(dataset.columns, dataset.rows.length))
  const [groupIndex, setGroupIndex] = useState<number | null>(dates[0]?.index ?? dimensions[0]?.index ?? null)
  const [period, setPeriod] = useState<Granularity>(() => dates.length ? chooseGranularity(dataset.rows, dates[0].index) : 'month')
  const [chart, setChart] = useState<ChartType>(dates.length ? 'line' : 'bar')
  const [filters, setFilters] = useState<Filter[]>([])
  const [mode, setMode] = useState<MatchMode>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterId = useId()
  const [tab, setTab] = useState<'overview' | 'table'>('overview')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const rows = useMemo(() => filterRows(dataset, filters, mode), [dataset, filters, mode])
  const cards = useMemo(() => statCards(dataset, rows, metric), [dataset, rows, metric])
  const metricColumn = metric.column === null ? undefined : dataset.columns[metric.column]
  const displayColumn = metric.aggregation === 'count' ? undefined : metricColumn
  const group = groupIndex === null ? undefined : dataset.columns[groupIndex]
  const dateGroup = group?.kind === 'date'
  const primary = useMemo(() => groupRows(rows, metric, group, period), [rows, metric, group, period])
  const category = dimensions.find(column => column.index !== groupIndex)
  const breakdown = useMemo(() => category ? groupRows(rows, metric, category, period).groups : [], [rows, metric, category, period])
  const shown = useMemo(() => dateGroup ? primary.groups.slice(-MAX_PERIODS) : primary.groups.slice(0, MAX_GROUPS), [dateGroup, primary.groups])
  const label = metricLabel(metric, metricColumn)
  const titleForChart = dateGroup ? `${label} over time` : group ? `${label} by ${group.name}` : label
  const chartSpec: ChartSpec = { data: shown, type: chart, period: dateGroup ? period : undefined, metric: displayColumn, title: titleForChart }
  const breakdownTitle = category ? `${label} by ${category.name}` : ''
  const fileBase = source.filename.replace(/\.[^.]+$/, '')
  const gaps = shown.filter(point => point.value === null).length
  const note = [
    primary.groups.length > shown.length ? `${dateGroup ? 'Latest' : 'Top'} ${shown.length} of ${integer.format(primary.groups.length)} ${dateGroup ? 'observed periods' : 'groups'}. Chart CSV includes every group.` : '',
    primary.excluded ? `${integer.format(primary.excluded)} ${primary.excluded === 1 ? 'row without a valid date is' : 'rows without valid dates are'} excluded from this chart.` : '',
    gaps ? `${gaps} ${dateGroup ? (gaps === 1 ? 'period' : 'periods') : (gaps === 1 ? 'group' : 'groups')} ${gaps === 1 ? 'has' : 'have'} no valid metric values.` : '',
  ].filter(Boolean).join(' ')
  const matchedLabel = `${integer.format(rows.length)} of ${integer.format(dataset.rows.length)} rows`
  const chartDetail = metricColumn ? `${aggregations[metric.aggregation]} · ${metricColumn.name}` : 'Count of rows'

  function changeGroup(value: string) {
    const next = value === '' ? null : Number(value)
    const nextDate = next !== null && dataset.columns[next].kind === 'date'
    if (nextDate) setPeriod(chooseGranularity(dataset.rows, next))
    if (Boolean(nextDate) !== Boolean(dateGroup)) setChart(nextDate ? 'line' : 'bar')
    setGroupIndex(next)
  }

  async function exportDashboard(extension: 'png' | 'pdf', menu: HTMLDetailsElement | null) {
    closePopover(menu)
    setExporting(true)
    setExportError('')
    const report: Report = {
      title, detail: [source.filename, source.sheet, matchedLabel, chartDetail, dateGroup ? periods[period] : group?.name].filter(Boolean).join(' · '),
      filters: filters.length ? `Match ${mode} · ${filters.length} ${filters.length === 1 ? 'condition' : 'conditions'}: ${filters.map(filter => {
        const col = dataset.columns[filter.column]
        return `${col.name} ${filterDescription(filter, col)}`
      }).join(' · ')}` : 'All rows · No dashboard filters',
      stats: cards, chart: chartSpec, note, breakdown: category ? { title: breakdownTitle, data: breakdown } : undefined,
    }
    try {
      const { downloadReport } = await import('./report')
      await downloadReport(`${fileBase}-dashboard`, extension, report)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Dashboard export failed. Try again.')
    } finally {
      setExporting(false)
    }
  }

  return <main id="main" className="workspace">
    <div className="workspace-heading">
      <div><div className="heading-with-tag"><h1 tabIndex={-1}>{title}</h1>{sample && <span className="tag"><span className="status-dot" /> Sample data</span>}</div>
        <p className="dataset-meta"><FileSpreadsheet size={15} /> <span title={source.filename}>{source.filename}</span>{source.sheet && <><span>·</span><span title={source.sheet}>{source.sheet}</span></>}
          <span>·</span> {integer.format(source.rows.length)} rows <span>·</span> {source.headers.length} columns</p></div>
      <div className="workspace-actions">
        <a className="button secondary new-import" href="#/import"><Upload size={16} /> New import</a>
        <a className="button secondary" href="#/review"><Settings2 size={16} /> Edit columns</a>
        <Popover className="export-menu" buttonClass="button primary" label={<><Download size={16} /> {exporting ? 'Exporting…' : 'Export'}</>}>
          <div className="panel export-choices">
            <button type="button" disabled={!rows.length} onClick={event => {
              closePopover(event.currentTarget.closest('details'))
              const allowed = new Set(rows)
              downloadCsv(`${fileBase}-filtered`, csv(source.headers, source.rows.filter((_, i) => allowed.has(dataset.rows[i]))))
            }}><Table2 size={16} /> Filtered rows (CSV)</button>
            <button type="button" disabled={!primary.groups.length} onClick={event => {
              closePopover(event.currentTarget.closest('details'))
              const heading = dateGroup ? `${group.name} (${periods[period]})` : group?.name ?? 'Group'
              downloadCsv(`${fileBase}-chart`, chartCsv(heading, label, primary.groups, displayColumn?.kind === 'percent' ? '%' : displayColumn?.unit))
            }}><ChartColumn size={16} /> Chart values (CSV)</button>
            <button type="button" disabled={exporting} onClick={event => { void exportDashboard('png', event.currentTarget.closest('details')) }}>
              <Image size={16} /> Dashboard image (PNG)
            </button>
            <button type="button" disabled={exporting} onClick={event => { void exportDashboard('pdf', event.currentTarget.closest('details')) }}>
              <FileText size={16} /> Dashboard report (PDF)
            </button>
          </div>
        </Popover>
      </div>
    </div>
    {exportError && <p className="notice error" role="alert">{exportError}</p>}
    <div className="workspace-nav">
      <div className="view-tabs" role="group" aria-label="Workspace view">
        <button type="button" aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}><Grid2X2 size={16} /> Overview</button>
        <button type="button" aria-pressed={tab === 'table'} onClick={() => setTab('table')}><Table2 size={16} /> Data table</button>
      </div>
      <div className="view-tools"><span className="matches" aria-live="polite">{matchedLabel}</span>
        <FilterButton open={filtersOpen} count={filters.length} controls={filterId} onClick={() => setFiltersOpen(!filtersOpen)} />
      </div>
    </div>
    <FilterPanel dataset={dataset} filters={filters} mode={mode} onChange={setFilters} onMode={setMode}
      open={filtersOpen} onOpen={setFiltersOpen} id={filterId} />
    {tab === 'overview' ? <>
      <Stats cards={cards} />
      <div className={`chart-grid${category ? '' : ' single-chart'}`}>
        <section className="panel trend-panel" aria-labelledby="main-chart-title">
          <div className="panel-heading trend-heading">
            <div><h2 id="main-chart-title">{titleForChart}</h2><p>{chartDetail}</p></div>
            {dateGroup && <div className="chart-toggle" role="group" aria-label="Chart type">
              <button type="button" aria-label="Line chart" title="Line chart" aria-pressed={chart === 'line'} onClick={() => setChart('line')}><ChartNoAxesCombined size={17} /></button>
              <button type="button" aria-label="Bar chart" title="Bar chart" aria-pressed={chart === 'bar'} onClick={() => setChart('bar')}><ChartColumn size={17} /></button>
            </div>}
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
          <Chart {...chartSpec} />
          {note && <p className="chart-note">{note}</p>}
        </section>
        {category && <Breakdown data={breakdown} column={displayColumn} title={breakdownTitle} />}
      </div>
    </> : <DataTable source={source} dataset={dataset} rows={rows} />}
  </main>
}
