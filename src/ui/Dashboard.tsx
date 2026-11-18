import { useId, useMemo, useState } from 'react'
import {
  ChartColumn, ChartNoAxesCombined, ChevronRight, Download, FileSpreadsheet, FileText, Grid2X2, Image,
  Info, Settings2, Table2, Upload,
} from 'lucide-react'
import {
  aggregations, chooseGranularity, coverageLabel, dateLabel, defaultMetric, groupRows, metricLabel, periods, recommendedAggregation, total,
} from '../data/analyze'
import type { Aggregation, Datum, Granularity, Metric } from '../data/analyze'
import type { AnalysisState } from '../data/analysisState'
import { columnLabel } from '../data/currency'
import { chartCsv, csv, downloadCsv } from '../data/export'
import { filterDescription, filterRows } from '../data/filters'
import { formatValue, integer, isMeasure } from '../data/model'
import type { Cell, Column, Dataset, Source } from '../data/model'
import { loadSample } from '../data/samples'
import { Chart } from './Chart'
import { breakdownLayout, groupLabel } from './chartLayout'
import type { ChartSpec } from './chartLayout'
import { DataTable } from './DataTable'
import type { TableExport } from './DataTable'
import { FilterButton, FilterPanel } from './FilterPanel'
import type { Report, Stat } from './report'
import { closePopover, Field, Popover, Select, WorkspaceLink } from './shared'

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
    const displayColumn = item.aggregation === 'count' ? undefined : column
    const roundPercent = displayColumn?.kind === 'percent' && result.value !== null && Math.abs(result.value) >= 0.01
    const condensed = roundPercent ? Number(result.value!.toFixed(2)) : result.value
    return {
      key: item.column ?? 'records', label: metricLabel(item, column),
      value: formatValue(condensed, displayColumn),
      exact: roundPercent && condensed !== result.value ? `${result.value}%` : undefined,
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
      {card.exact ? <details className="stat-precision">
        <summary title={`Exact value ${card.exact}`}><strong>{card.value}</strong><Info size={12} aria-hidden="true" /></summary>
        <span>Exact value {card.exact}</span>
      </details> : <strong className="stat-value" title={card.value}>{card.value}</strong>}
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
        <div><span title={groupLabel(item.key)}>{groupLabel(item.key)}</span><strong>{formatValue(item.value, column)}</strong></div>
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
    <div className="preview-top"><span><Grid2X2 size={15} /> <strong>Retail sales</strong></span>
      <div><span className="preview-date">{rangeLabel}</span><span className="tag"><span className="status-dot" /> Sample preview</span></div>
    </div>
    <div className="preview-body">
      <Stats cards={statCards(dataset, dataset.rows, metric)} />
      <div className="chart-grid">
        <section className="panel trend-panel"><div className="panel-heading"><div><h2>Revenue over time</h2><p>Sum of revenue by month</p></div></div>
          <Chart data={trend} type="line" period="month" metric={column} title="Revenue over time" interactive={false} /></section>
        <Breakdown data={regions} column={column} title="Revenue by region" />
      </div>
    </div>
  </div>
}

export function Dashboard({ source, dataset, title, sample, analysis, onAnalysis, onReview }: {
  source: Source; dataset: Dataset; title: string; sample: boolean; analysis: AnalysisState; onAnalysis: (patch: Partial<AnalysisState>) => void
  onReview: () => void
}) {
  const dates = dataset.columns.filter(column => column.kind === 'date' && column.invalid + column.missing < dataset.rows.length)
  const dimensions = dataset.columns.filter(column => column.kind === 'category')
  const measures = dataset.columns.filter(column => isMeasure(column.kind))
  const { metric, groupIndex, period, chart, filters, mode, tab, table, removedFilters } = analysis
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterId = useId()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportStatus, setExportStatus] = useState('')
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
  const chartDetail = [
    metricColumn ? `${aggregations[metric.aggregation]} · ${columnLabel(metricColumn)}` : 'Count of rows',
    dateGroup ? `${group.name} by ${period}` : undefined,
  ].filter(Boolean).join(' · ')
  const canGroup = dates.length > 0 || dimensions.length > 0

  function showResults() {
    setFiltersOpen(false)
    requestAnimationFrame(() => document.getElementById('analysis-results')?.focus())
  }

  function editFilters() {
    setFiltersOpen(true)
    requestAnimationFrame(() => document.getElementById(filterId)?.querySelector<HTMLSelectElement>('[data-filter-field="column"]')?.focus())
  }

  function changeGroup(value: string) {
    const next = value === '' ? null : Number(value)
    const nextDate = next !== null && dataset.columns[next].kind === 'date'
    onAnalysis({ groupIndex: next, period: nextDate ? chooseGranularity(dataset.rows, next) : period,
      chart: Boolean(nextDate) !== Boolean(dateGroup) ? nextDate ? 'line' : 'bar' : chart })
  }

  async function exportDashboard(extension: 'png' | 'pdf' | 'html', menu: HTMLDetailsElement | null) {
    closePopover(menu)
    setExporting(true)
    setExportError('')
    setExportStatus(`Preparing ${extension.toUpperCase()} export…`)
    const report: Report = {
      title, detail: [source.filename, source.sheet, matchedLabel, chartDetail, dateGroup ? undefined : group?.name].filter(Boolean).join(' · '),
      filters: { mode, conditions: filters.map(filter => {
        const col = dataset.columns[filter.column]
        return `${columnLabel(col)} ${filterDescription(filter, col)}`
      }) },
      stats: cards, chart: group && rows.length ? chartSpec : undefined,
      note: rows.length ? note : 'No rows match these filters.',
      breakdown: category && rows.length ? { title: breakdownTitle, data: breakdown, metric: displayColumn } : undefined,
    }
    try {
      const { downloadReport } = await import('./report')
      await downloadReport(`${fileBase}-dashboard`, extension, report)
      setExportStatus(`${extension.toUpperCase()} download started.`)
    } catch (error) {
      setExportStatus('')
      setExportError(error instanceof Error ? error.message : 'Dashboard export failed. Try again.')
    } finally {
      setExporting(false)
    }
  }

  function exportCsv(menu: HTMLDetailsElement | null, download: () => void) {
    closePopover(menu)
    setExportError('')
    try {
      download()
      setExportStatus('CSV download started.')
    } catch (error) {
      setExportStatus('')
      setExportError(error instanceof Error ? error.message : 'CSV export failed. Try again.')
    }
  }

  function exportMenu(selection?: TableExport) {
    const scopePending = removedFilters.length > 0
    const unavailable = scopePending ? 'Confirm the export scope to download files.'
      : selection?.pending ? 'Updating the table results…'
      : !(selection?.count ?? rows.length) ? 'There are no matching rows to export.' : undefined
    return <Popover className="export-menu" buttonClass="button primary" label={<><Download size={16} /> {selection ? 'Export table' : exporting ? 'Exporting…' : 'Export'}</>}>
      <div className="panel export-choices">
        {unavailable && <p className="export-note">{unavailable}</p>}
        {selection ? <>
          <p className="export-group">{integer.format(selection.count)} {selection.count === 1 ? 'row' : 'rows'} in the table</p>
          <button type="button" disabled={Boolean(unavailable)} onClick={event => exportCsv(event.currentTarget.closest('details'), selection.download)}>
            <Table2 size={16} /> Table results (CSV)
          </button>
        </> : <>
          <p className="export-group">Data · {integer.format(rows.length)} matching {rows.length === 1 ? 'row' : 'rows'}</p>
          <button type="button" disabled={Boolean(unavailable)} onClick={event => exportCsv(event.currentTarget.closest('details'), () => {
            const allowed = new Set(rows)
            downloadCsv(`${fileBase}-filtered`, csv(source.headers, source.rows.filter((_, i) => allowed.has(dataset.rows[i]))))
          })}><Table2 size={16} /> Filtered rows (CSV)</button>
          <button type="button" disabled={!group || !primary.groups.length || scopePending} onClick={event => exportCsv(event.currentTarget.closest('details'), () => {
            const heading = dateGroup ? `${group.name} (${periods[period]})` : group?.name ?? 'Group'
            downloadCsv(`${fileBase}-chart`, chartCsv(heading, label, primary.groups, displayColumn?.kind === 'percent' ? '%' : displayColumn?.unit))
          })}><ChartColumn size={16} /> Chart values (CSV)</button>
          {!group && !unavailable && <p className="export-note">Choose a grouping to export chart values.</p>}
          <p className="export-group export-report-group">Dashboard reports</p>
          <button type="button" disabled={exporting || scopePending} onClick={event => { void exportDashboard('png', event.currentTarget.closest('details')) }}>
            <Image size={16} /> Dashboard image (PNG)
          </button>
          <button type="button" disabled={exporting || scopePending} onClick={event => { void exportDashboard('pdf', event.currentTarget.closest('details')) }}>
            <FileText size={16} /> Dashboard report (PDF)
          </button>
          <button type="button" disabled={exporting || scopePending} onClick={event => { void exportDashboard('html', event.currentTarget.closest('details')) }}>
            <FileText size={16} /> Accessible report (HTML)
          </button>
        </>}
      </div>
    </Popover>
  }

  return <main id="main" className="workspace">
    <div className="workspace-heading">
      <div className="dataset-identity"><div className="heading-with-tag"><h1 tabIndex={-1} title={title}>{title}</h1>{sample && <span className="tag"><span className="status-dot" /> Sample data</span>}</div>
        <div className="dataset-meta">
          <details className="dataset-source">
            <summary aria-label="Source file"><FileSpreadsheet size={15} /><span>Source file</span><ChevronRight size={12} /></summary>
            <div className="panel dataset-source-details"><strong>{source.filename}</strong>{source.sheet && <span>Worksheet {source.sheet}</span>}</div>
          </details>
          <span aria-hidden="true">·</span><span>{integer.format(source.rows.length)} rows · {source.headers.length} columns</span>
        </div></div>
      <div className="workspace-actions">
        <a className="button secondary new-import" href="#/import"><Upload size={16} /> New import</a>
        <WorkspaceLink route="review" onFollow={onReview}><Settings2 size={16} /> Edit columns</WorkspaceLink>
        {tab === 'overview' && exportMenu()}
      </div>
    </div>
    {exportError && <p className="notice error" role="alert">{exportError}</p>}
    <p className={exportStatus ? 'export-status' : 'sr-only'} role="status">{exportStatus}</p>
    {removedFilters.length > 0 && <div className="notice scope-notice" role="status"><Info size={18} />
      <div><strong>Column changes removed {removedFilters.length === 1 ? 'a filter' : 'filters'}.</strong>
        <ul>{removedFilters.map((description, index) => <li key={index}>{description}</li>)}</ul>
        <p>Review the matching rows before confirming the new export scope.</p>
      </div>
      <button type="button" className="button secondary" onClick={() => onAnalysis({ removedFilters: [] })}>Confirm export scope</button>
    </div>}
    <div className="workspace-nav">
      <div className="view-tabs" role="group" aria-label="Workspace view">
        <button type="button" aria-pressed={tab === 'overview'} onClick={() => onAnalysis({ tab: 'overview' })}><Grid2X2 size={16} /> Overview</button>
        <button type="button" aria-pressed={tab === 'table'} onClick={() => onAnalysis({ tab: 'table' })}><Table2 size={16} /> Data table</button>
      </div>
      <div className="view-tools"><span className={`matches${filters.length ? '' : ' unfiltered'}`} aria-live="polite">{matchedLabel}</span>
        <FilterButton open={filtersOpen} count={filters.length} controls={filterId} onClick={() => setFiltersOpen(!filtersOpen)} />
      </div>
    </div>
    <FilterPanel dataset={dataset} filters={filters} mode={mode} onChange={filters => onAnalysis({ filters, table: { ...table, page: 0 } })}
      onMode={mode => onAnalysis({ mode, table: { ...table, page: 0 } })}
      open={filtersOpen} onOpen={setFiltersOpen} onViewResults={showResults} id={filterId} />
    <div id="analysis-results" tabIndex={-1} className="analysis-results" aria-label="Analysis results">
    {rows.length === 0 && filters.length > 0 && <section className="panel no-matches">
      <h2>No rows match these filters</h2>
      <p>Edit a condition or clear the filters to see the dataset again.</p>
      <div><button type="button" className="button secondary" onClick={editFilters}>Edit filters</button>
        <button type="button" className="button primary" onClick={() => { onAnalysis({ filters: [], mode: 'all', table: { ...table, page: 0 } }); showResults() }}>Clear all filters</button></div>
    </section>}
    {tab === 'overview' ? rows.length > 0 && <>
      <Stats cards={cards} />
      {canGroup || measures.length > 0 ? <div className={`chart-grid${category ? '' : ' single-chart'}`}>
        <section className="panel trend-panel" aria-labelledby="main-chart-title">
          <div className="panel-heading trend-heading">
            <div><h2 id="main-chart-title">{group ? titleForChart : 'Analysis settings'}</h2><p>{chartDetail}</p></div>
            {dateGroup && <div className="chart-toggle" role="group" aria-label="Chart type">
              <button type="button" aria-label="Line chart" title="Line chart" aria-pressed={chart === 'line'} onClick={() => onAnalysis({ chart: 'line' })}><ChartNoAxesCombined size={17} /></button>
              <button type="button" aria-label="Bar chart" title="Bar chart" aria-pressed={chart === 'bar'} onClick={() => onAnalysis({ chart: 'bar' })}><ChartColumn size={17} /></button>
            </div>}
          </div>
          <div className="chart-controls">
            <Field label="Metric"><Select value={metric.column ?? ''} onChange={event => {
              const index = event.target.value
              onAnalysis({ metric: index === '' ? { column: null, aggregation: 'count' } : { column: Number(index), aggregation: recommendedAggregation(dataset.columns[Number(index)]) } })
            }}><option value="">Records</option>{measures.map(column => <option key={column.index} value={column.index}>{columnLabel(column)}</option>)}</Select></Field>
            {metricColumn && <Field label="Aggregation"><Select value={metric.aggregation} onChange={event => onAnalysis({ metric: { ...metric, aggregation: event.target.value as Aggregation } })}>
              {Object.entries(aggregations).filter(([key]) => key !== 'sum' || metricColumn.kind !== 'percent').map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </Select></Field>}
            <Field label="Group by"><Select value={groupIndex ?? ''} onChange={event => changeGroup(event.target.value)}>
              <option value="">All records</option>{[...dates, ...dimensions].map(column => <option key={column.index} value={column.index}>{column.name}</option>)}
            </Select></Field>
            {dateGroup && <Field label="Date granularity"><Select value={period} onChange={event => onAnalysis({ period: event.target.value as Granularity })}>
              {Object.entries(periods).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </Select></Field>}
          </div>
          {group ? <Chart {...chartSpec} /> : <p className="ungrouped-note">Choose a grouping to compare the values.</p>}
          {note && <p className="chart-note">{note}</p>}
          {dateGroup && shown.length > 0 && <details className="chart-values">
            <summary>View chart values ({shown.length})</summary>
            <dl>{shown.map((point, index) => <div key={index}>
              <dt>{groupLabel(point.key, chartSpec.period, true)}{point.coverage && point.coverage.days < point.coverage.periodDays && <small>{coverageLabel(point.coverage)}</small>}</dt>
              <dd>{formatValue(point.value, displayColumn)}</dd>
            </div>)}</dl>
          </details>}
        </section>
        {category && <Breakdown data={breakdown} column={displayColumn} title={breakdownTitle} />}
      </div> : <button type="button" className="button secondary view-rows" onClick={() => { onAnalysis({ tab: 'table' }); showResults() }}><Table2 size={16} /> View rows</button>}
    </> : <DataTable source={source} dataset={dataset} rows={rows} state={table} renderExport={exportMenu}
      onChange={patch => onAnalysis({ table: { ...table, ...patch } })} />}
    </div>
  </main>
}
