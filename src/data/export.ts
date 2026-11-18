import type { Datum } from './analyze'
import { headerUnit } from './currency'
import { sourceValue } from './model'
import type { Cell, Column, SourceCell } from './model'

export function csv(headers: string[], rows: SourceCell[][]): string {
  const encode = (input: SourceCell) => {
    const cell = sourceValue(input)
    if (cell === null) return ''
    if (typeof cell !== 'string') return String(cell)
    const signedNumber = /^[+-](?:\d+(?:[.,]\d+)*|[.,]\d+)(?:e[+-]?\d+)?$/i.test(cell)
    const safe = !signedNumber && (/^[\s\p{Cf}]*[=+@＝＋＠－-]|^[\t\r\n]/u.test(cell)) ? `'${cell}` : cell
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return '\uFEFF' + [headers, ...rows].map(row => row.map(encode).join(',')).join('\r\n')
}

function uniqueHeaders(headers: string[]) {
  const used = new Set<string>()
  return headers.map(header => {
    let unique = header
    let index = 2
    while (used.has(unique.toLowerCase())) unique = `${header} (${index++})`
    used.add(unique.toLowerCase())
    return unique
  })
}

export function chartCsv(group: string, label: string, data: Datum[], unit?: string): string {
  const value = unit ? `${label} (${unit})` : label
  return csv(uniqueHeaders([group, value, 'Records', 'Valid values']), data.map(d => [d.key, d.value, d.records, d.valid]))
}

export function typedCsv(columns: Column[], rows: Cell[][]) {
  const headers = columns.map(({ name, kind, unit }) => {
    if (kind === 'percent' && !/[%٪]|\bpercent(?:age)?\b/i.test(name)) return `${name} (%)`
    if (kind === 'currency' && unit && headerUnit(name) !== unit) return `${name} (${unit})`
    return name
  })
  return csv(uniqueHeaders(headers), rows)
}

export function downloadCsv(name: string, text: string) {
  downloadFile(name, 'csv', new Blob([text], { type: 'text/csv;charset=utf-8' }))
}

export function downloadFile(name: string, extension: 'csv' | 'png' | 'pdf', blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 140).replace(/^[-.]+|[-.]+$/g, '') || 'datacanvas'}.${extension}`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
