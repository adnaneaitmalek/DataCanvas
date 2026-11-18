import type { Datum } from './analyze'
import type { Cell } from './model'

export function csv(headers: string[], rows: Cell[][]): string {
  const encode = (cell: Cell) => {
    if (cell === null) return ''
    if (typeof cell !== 'string') return String(cell)
    const signedNumber = /^[+-](?:\d+(?:[.,]\d+)*|[.,]\d+)(?:e[+-]?\d+)?$/i.test(cell)
    const safe = !signedNumber && (/^[\s\p{Cf}]*[=+@-]|^[\t\r\n]/u.test(cell)) ? `'${cell}` : cell
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return '\uFEFF' + [headers, ...rows].map(row => row.map(encode).join(',')).join('\r\n')
}

export function chartCsv(group: string, label: string, data: Datum[], unit?: string): string {
  const value = unit ? `${label} (${unit})` : label
  return csv([group, value, 'Records', 'Valid values'], data.map(d => [d.key, d.value, d.records, d.valid]))
}

export function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '') || 'datacanvas'}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
