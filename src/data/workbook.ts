import { read, utils } from '@e965/xlsx'
import type { CellObject } from '@e965/xlsx'
import { toSource } from './import'
import { limits } from './model'
import type { Cell, Source } from './model'

function preflight(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const invalid = () => new Error('This is not a readable .xlsx workbook. Save an unprotected .xlsx copy and try again.')
  if (view.byteLength < 22 || view.getUint32(0, true) !== 0x04034b50) throw invalid()
  for (let end = view.byteLength - 22; end >= Math.max(0, view.byteLength - 65_557); end--) {
    if (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== view.byteLength) continue
    const entries = view.getUint16(end + 10, true)
    let pos = view.getUint32(end + 16, true)
    let expanded = 0
    if (entries > 4096 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw invalid()
    for (let i = 0; i < entries; i++) {
      if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) throw invalid()
      if (view.getUint16(pos + 8, true) & 1) throw invalid()
      expanded += view.getUint32(pos + 24, true)
      if (expanded > limits.workbookBytes) throw new Error('The expanded workbook exceeds 120 MB. Save just the sheet you need or export it as CSV.')
      pos += 46 + view.getUint16(pos + 28, true) + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true)
    }
    if (pos > end) throw invalid()
    return
  }
  throw invalid()
}

function cellValue(cell?: CellObject): Cell {
  if (!cell || cell.v == null || cell.t === 'e' || cell.t === 'z') return null
  if (cell.v instanceof Date) {
    if (!Number.isFinite(cell.v.getTime())) return null
    return `${cell.v.getFullYear()}-${String(cell.v.getMonth() + 1).padStart(2, '0')}-${String(cell.v.getDate()).padStart(2, '0')}`
  }
  if (typeof cell.v === 'number') {
    if (!Number.isFinite(cell.v)) return null
    if (String(cell.z ?? '').includes('%') && cell.w?.includes('%')) return `${Number((cell.v * 100).toPrecision(15))}%`
    const unit = cell.w?.match(/US\$|A\$|C\$|NZ\$|R\$|[$€£¥₹₩]/)?.[0]
    if (unit) return `${unit} ${cell.v}`
    if (/^0{2,}$/.test(String(cell.z ?? '')) && cell.w) return cell.w
  }
  return cell.v
}

export function readWorkbook(buffer: ArrayBuffer, filename: string, requested?: string): Source {
  preflight(buffer)
  let sheets: string[]
  try {
    const book = read(buffer, { sheets: [], sheetRows: 1 })
    sheets = book.SheetNames.filter((_, index) => !book.Workbook?.Sheets?.[index]?.Hidden)
  } catch {
    throw new Error('This workbook could not be opened. Save an unprotected .xlsx copy and try again.')
  }
  if (!sheets.length) throw new Error('This workbook has no visible worksheets.')
  const choices = requested ? [requested] : sheets
  let problem = 'The workbook has no usable worksheets.'

  for (const name of choices) {
    try {
      if (!sheets.includes(name)) throw new Error('Choose a visible worksheet from this workbook.')
      const book = read(buffer, {
        sheets: name, cellDates: true, cellNF: true, cellText: true, sheetRows: limits.rows + 2,
        cellHTML: false, cellStyles: false, bookVBA: false,
      })
      const worksheet = book.Sheets[name]
      const reference = worksheet?.['!fullref'] ?? worksheet?.['!ref']
      if (!reference) throw new Error('This worksheet is empty.')
      const range = utils.decode_range(reference)
      const rowCount = range.e.r - range.s.r + 1
      const width = range.e.c - range.s.c + 1
      if (width > limits.columns || rowCount > limits.rows + 1 || rowCount * width > limits.cells + limits.columns) {
        throw new Error('The worksheet exceeds 100,000 rows, 100 columns, or 1,000,000 cells. Remove unused rows or columns and retry.')
      }
      const matrix: Cell[][] = []
      let errors = 0
      let formulas = 0
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: Cell[] = []
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = worksheet[utils.encode_cell({ r, c })] as CellObject | undefined
          if (cell?.t === 'e') errors++
          else if (cell?.f) formulas++
          row.push(cellValue(cell))
        }
        matrix.push(row)
      }
      const notices: string[] = []
      if (errors) notices.push(`${errors} Excel error cell${errors === 1 ? ' was' : 's were'} imported as missing.`)
      if (formulas) notices.push('Formula cells use the values last saved by Excel. Formulas are never run in DataCanvas.')
      return toSource(matrix, { filename, sheet: name, sheets, notices })
    } catch (error) {
      if (problem === 'The workbook has no usable worksheets.' || requested) {
        problem = error instanceof Error ? error.message : 'This worksheet could not be read.'
      }
    }
  }
  throw new Error(problem)
}
