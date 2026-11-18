import { read, SSF, utils } from '@e965/xlsx'
import type { CellObject } from '@e965/xlsx'
import { toSource } from './import'
import { limits } from './model'
import type { Source, SourceCell } from './model'
import { currencyParts, currencyUnit } from './currency'

const invalidWorkbook = () => new Error('This is not a readable .xlsx workbook. Save an unprotected .xlsx copy and try again.')

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value
})

function updateCrc(crc: number, bytes: Uint8Array) {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return crc
}

function archiveEntries(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  if (view.byteLength < 22 || view.getUint32(0, true) !== 0x04034b50) throw invalidWorkbook()
  const extraFields = (start: number, size: number) => {
    const end = start + size
    while (start < end) {
      // ZIP64 can override the sizes in the headers and is outside the import limits.
      if (start + 4 > end || view.getUint16(start, true) === 1) throw invalidWorkbook()
      start += 4 + view.getUint16(start + 2, true)
    }
    if (start !== end) throw invalidWorkbook()
  }
  for (let end = view.byteLength - 22; end >= Math.max(0, view.byteLength - 65_557); end--) {
    if (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== view.byteLength) continue
    const entries = view.getUint16(end + 10, true)
    const start = view.getUint32(end + 16, true)
    const length = view.getUint32(end + 12, true)
    let pos = start
    let expanded = 0
    const entriesToCheck: { method: number; dataStart: number; compressed: number; size: number; checksum: number }[] = []
    if (!entries || entries > 4096 || start + length !== end || view.getUint16(end + 8, true) !== entries ||
      view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw invalidWorkbook()
    for (let i = 0; i < entries; i++) {
      if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) throw invalidWorkbook()
      const flags = view.getUint16(pos + 8, true)
      const method = view.getUint16(pos + 10, true)
      const checksum = view.getUint32(pos + 16, true)
      const compressed = view.getUint32(pos + 20, true)
      const size = view.getUint32(pos + 24, true)
      const nameLength = view.getUint16(pos + 28, true)
      const extraLength = view.getUint16(pos + 30, true)
      const next = pos + 46 + nameLength + extraLength + view.getUint16(pos + 32, true)
      const local = view.getUint32(pos + 42, true)
      if (next > end || (flags & 0x2041) || (method !== 0 && method !== 8) || (method === 0 && compressed !== size) ||
        local + 30 > start || view.getUint32(local, true) !== 0x04034b50 ||
        view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
        view.getUint16(local + 26, true) !== nameLength) throw invalidWorkbook()
      const localExtra = view.getUint16(local + 28, true)
      const dataStart = local + 30 + nameLength + localExtra
      const dataEnd = dataStart + compressed
      if (dataEnd > start) throw invalidWorkbook()
      if (flags & 8) {
        const signed = dataEnd + 4 <= start && view.getUint32(dataEnd, true) === 0x08074b50
        const descriptor = dataEnd + (signed ? 4 : 0)
        if (descriptor + 12 > start || view.getUint32(descriptor, true) !== checksum ||
          view.getUint32(descriptor + 4, true) !== compressed || view.getUint32(descriptor + 8, true) !== size) throw invalidWorkbook()
      } else if (view.getUint32(local + 14, true) !== checksum ||
        view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== size) {
        throw invalidWorkbook()
      }
      for (let j = 0; j < nameLength; j++) {
        if (view.getUint8(pos + 46 + j) !== view.getUint8(local + 30 + j)) throw invalidWorkbook()
      }
      extraFields(pos + 46 + nameLength, extraLength)
      extraFields(local + 30 + nameLength, localExtra)
      expanded += size
      if (expanded > limits.workbookBytes) throw new Error('The expanded workbook exceeds 120 MB. Save just the sheet you need or export it as CSV.')
      entriesToCheck.push({ method, dataStart, compressed, size, checksum })
      pos = next
    }
    if (pos !== end) throw invalidWorkbook()
    return entriesToCheck
  }
  throw invalidWorkbook()
}

async function validateArchive(buffer: ArrayBuffer) {
  for (const { method, dataStart, compressed, size, checksum } of archiveEntries(buffer)) {
    const bytes = new Uint8Array(buffer, dataStart, compressed)
    if (method === 0) {
      if (((updateCrc(-1, bytes) ^ -1) >>> 0) !== checksum) throw invalidWorkbook()
      continue
    }
    let decoder: DecompressionStream
    try {
      decoder = new DecompressionStream('deflate-raw')
    } catch {
      throw new Error('This browser cannot validate compressed Excel files. Use a current browser or export the sheet as CSV.')
    }
    const reader = new Blob([bytes]).stream().pipeThrough(decoder).getReader()
    let actual = 0
    let crc = -1
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        actual += chunk.value.byteLength
        if (actual > size) {
          await reader.cancel()
          throw invalidWorkbook()
        }
        crc = updateCrc(crc, chunk.value)
      }
    } catch {
      throw invalidWorkbook()
    } finally {
      reader.releaseLock()
    }
    if (actual !== size || ((crc ^ -1) >>> 0) !== checksum) throw invalidWorkbook()
  }
}

function cellValue(cell: CellObject | undefined, date1904: boolean): SourceCell {
  if (!cell || cell.v == null || cell.t === 'e' || cell.t === 'z') return null
  if (cell.v instanceof Date) {
    if (!Number.isFinite(cell.v.getTime())) return null
    return cell.v.toISOString().slice(0, 10)
  }
  if (typeof cell.v === 'number') {
    if (!Number.isFinite(cell.v)) return null
    const format = String(cell.z ?? '')
    const semanticFormat = format.replace(/"[^"]*"|\\.|\[\$[^\]]*\]/g, '')
    if (SSF.is_date(format)) {
      if (!/[dy]/i.test(semanticFormat) && /[hs]|\[m+\]/i.test(semanticFormat)) return cell.w || null
      const date = SSF.parse_date_code(cell.v, { date1904 })
      if (!date || date.d === 0 || date.y === 1900 && date.m === 2 && date.d === 29) return null
      return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
    }
    if (semanticFormat.includes('%') && cell.w?.includes('%')) {
      const amount = Number((cell.v * 100).toPrecision(15))
      return { amount, unit: '%', display: `${amount}%` }
    }
    const token = /\[\$([^\]-]+)(?:-[^\]]*)?\]/.exec(format)?.[1]
    const unit = currencyUnit(token ?? '') ?? currencyParts(cell.w ?? '')?.unit
    if (unit) return { amount: cell.v, unit, display: `${unit} ${cell.v}` }
    if (/^0{2,}$/.test(format) && cell.w) return cell.w
  }
  return cell.v
}

export async function readWorkbook(buffer: ArrayBuffer, filename: string, requested?: string): Promise<Source> {
  await validateArchive(buffer)
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
        sheets: name, cellDates: false, cellNF: true, cellText: true, sheetRows: limits.rows + 2,
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
      const matrix: SourceCell[][] = []
      const date1904 = Boolean(book.Workbook?.WBProps?.date1904)
      let errors = 0
      let formulas = 0
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: SourceCell[] = []
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = worksheet[utils.encode_cell({ r, c })] as CellObject | undefined
          if (cell?.t === 'e') errors++
          if (cell?.f) formulas++
          row.push(cellValue(cell, date1904))
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
