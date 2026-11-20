import type { Column, Dataset, Source } from './model'

export const needsColumnReview = (column: Column) => Boolean(column.invalid || column.note || column.confirmPercentScale)

export function interpretationKey(column: Column) {
  const { kind, unit, numberStyle, dateOrder, percentScale, allowUnmarked, invalid, note } = column
  return JSON.stringify([kind, unit, numberStyle, dateOrder, percentScale, allowUnmarked, invalid, note])
}

export function columnNeedsDecision(column: Column) {
  if (column.confirmPercentScale || column.kind === 'currency' && column.unit === '$') return true
  return needsColumnReview(column) && column.acceptedInterpretation !== interpretationKey(column)
}

export function importReview(source: Source, dataset: Dataset) {
  const delimiter = Boolean(source.dialect?.ambiguous.length)
  const worksheet = Boolean(source.sheets && source.sheets.length > 1)
  const columns = dataset.columns.filter(needsColumnReview)
  const percentScale = columns.some(column => column.confirmPercentScale)
  const decisions = dataset.columns.filter(columnNeedsDecision)
  return {
    delimiter, worksheet, columns, percentScale, decisions,
    required: Boolean(delimiter || worksheet || columns.length || source.notices.length),
    blocked: delimiter || decisions.length > 0,
  }
}
