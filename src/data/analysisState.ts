import { chooseGranularity, defaultMetric } from './analyze'
import type { ChartType, Granularity, Metric } from './analyze'
import { columnLabel } from './currency'
import { filterDescription } from './filters'
import type { Filter, MatchMode } from './filters'
import { isMeasure } from './model'
import type { Column, Dataset } from './model'

export type TableState = { query: string; page: number; raw: boolean; sort?: { column: number; ascending: boolean } }
export type AnalysisState = {
  metric: Metric
  groupIndex: number | null
  period: Granularity
  chart: ChartType
  filters: Filter[]
  mode: MatchMode
  tab: 'overview' | 'table'
  table: TableState
  removedFilters: string[]
}

export function initialAnalysis(dataset: Dataset): AnalysisState {
  const date = dataset.columns.find(column => column.kind === 'date' && column.invalid + column.missing < dataset.rows.length)
  const category = dataset.columns.find(column => column.kind === 'category')
  return {
    metric: defaultMetric(dataset.columns, dataset.rows.length),
    groupIndex: date?.index ?? category?.index ?? null,
    period: date ? chooseGranularity(dataset.rows, date.index) : 'month',
    chart: date ? 'line' : 'bar',
    filters: [], mode: 'all', tab: 'overview', table: { query: '', page: 0, raw: false },
    removedFilters: [],
  }
}

function sameInterpretation(before: Column, next: Column) {
  if (before.kind !== next.kind) return false
  if (next.kind === 'date') return before.dateOrder === next.dateOrder
  if (!isMeasure(next.kind)) return true
  return before.unit === next.unit && before.numberStyle === next.numberStyle &&
    before.percentScale === next.percentScale && before.allowUnmarked === next.allowUnmarked
}

export function reconcileAnalysis(previous: Dataset, next: Dataset, state: AnalysisState, reparsed = false): AnalysisState {
  const byName = new Map(next.columns.map(column => [column.name, column]))
  const remap = (index: number) => byName.get(previous.columns[index].name)
  const filters: Filter[] = []
  const removed = [...state.removedFilters]
  for (const filter of state.filters) {
    const old = previous.columns[filter.column]
    const column = remap(filter.column)
    if (column && !reparsed && sameInterpretation(old, column)) filters.push({ ...filter, column: column.index })
    else removed.push(`${columnLabel(old)} ${filterDescription(filter, old)}`)
  }

  const oldMetric = state.metric.column === null ? undefined : remap(state.metric.column)
  const metric = state.metric.column === null ? state.metric
    : oldMetric && isMeasure(oldMetric.kind) && !(oldMetric.kind === 'percent' && state.metric.aggregation === 'sum')
      ? { ...state.metric, column: oldMetric.index } : defaultMetric(next.columns, next.rows.length)
  const oldGroup = state.groupIndex === null ? undefined : remap(state.groupIndex)
  const group = oldGroup?.kind === 'category' || oldGroup?.kind === 'date' && oldGroup.missing + oldGroup.invalid < next.rows.length
    ? oldGroup : undefined
  const sort = state.table.sort
  const sortedColumn = sort ? remap(sort.column) : undefined
  return {
    ...state, metric, groupIndex: group?.index ?? null, chart: group?.kind === 'date' ? state.chart : 'bar',
    filters, removedFilters: removed,
    table: {
      ...state.table,
      sort: sort && sortedColumn ? { ...sort, column: sortedColumn.index } : undefined,
      page: reparsed || removed.length > state.removedFilters.length ? 0 : state.table.page,
    },
  }
}
