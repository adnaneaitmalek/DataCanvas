import Papa from 'papaparse'
import { integer, limits, validateFile } from './model'
import type { Cell, Source } from './model'

type ImportMetadata = Omit<Source, 'headers' | 'rows'>

export function toSource(matrix: Cell[][], metadata: ImportMetadata, strictWidth = false): Source {
  const populated = matrix.filter(row => row.some(value => value !== null && String(value).trim() !== ''))
  if (!populated.length) throw new Error('No data was found. Put column names on the first non-empty row.')
  const [header, ...body] = populated
  const width = header.length
  if (width > limits.columns) throw new Error(`This sheet has more than ${limits.columns} columns. Remove unused columns and retry.`)
  if (body.length > limits.rows || body.length * width > limits.cells) {
    throw new Error('This sheet exceeds 100,000 rows or 1,000,000 cells. Split it into smaller files.')
  }

  const used = new Set<string>()
  let renamed = 0
  const headers = Array.from({ length: width }, (_, i) => {
    const original = String(header[i] ?? '').trim()
    if (original.length > limits.cellLength) throw new Error('A column header exceeds 32,767 characters. Shorten it and retry.')
    const base = original || `Column ${i + 1}`
    let name = base
    let suffix = 2
    while (used.has(name.toLowerCase())) name = `${base} (${suffix++})`
    if (name !== original) renamed++
    used.add(name.toLowerCase())
    return name
  })

  let short = 0
  let long = 0
  const rows: Cell[][] = []
  for (const row of body) {
    if (row.length > width) {
      long++
      continue
    }
    if (strictWidth && row.length < width) short++
    if (row.some(value => typeof value === 'string' && value.length > limits.cellLength)) {
      throw new Error('A cell exceeds 32,767 characters. Shorten long text fields and retry.')
    }
    rows.push(Array.from({ length: width }, (_, i) => row[i] ?? null))
  }
  if (!rows.length) throw new Error('No usable data rows were found below the headers. Check that rows match the header columns.')
  const notices = [...metadata.notices]
  if (renamed) notices.push(`${integer.format(renamed)} blank or duplicate header${renamed === 1 ? ' was' : 's were'} renamed.`)
  if (short) notices.push(`${integer.format(short)} short row${short === 1 ? ' was' : 's were'} padded with missing cells.`)
  if (long) notices.push(`${integer.format(long)} row${long === 1 ? ' with extra fields was' : 's with extra fields were'} skipped.`)
  return { ...metadata, headers, rows, notices }
}

export function readDelimited(text: string, filename: string, tsv = false): Source {
  if (text.includes('\u0000')) throw new Error('This text file contains invalid characters. Save it as a UTF-8 CSV or TSV and try again.')
  const parsed = Papa.parse<string[]>(text, {
    delimiter: tsv ? '\t' : '',
    delimitersToGuess: [',', ';', '\t', '|'],
    preview: limits.rows + 2,
    skipEmptyLines: 'greedy',
  })
  const quoteError = parsed.errors.find(error => error.type === 'Quotes')
  if (quoteError) {
    throw new Error(`Invalid quoting near data record ${(quoteError.row ?? 0) + 1}. Fix the quotes in the file and try again.`)
  }
  if (parsed.meta.truncated || parsed.data.length > limits.rows + 1) {
    throw new Error('This file exceeds 100,000 data rows. Split it into smaller files and try again.')
  }
  return toSource(parsed.data, { filename, notices: [] }, true)
}

export async function readSource(file: File, sheet?: string): Promise<Source> {
  const extension = validateFile(file.name, file.size)
  if (extension === 'xlsx') {
    const { readWorkbook } = await import('./workbook')
    return readWorkbook(await file.arrayBuffer(), file.name, sheet)
  }
  const bytes = await file.arrayBuffer()
  const prefix = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2))
  const encoding = prefix[0] === 0xff && prefix[1] === 0xfe ? 'utf-16le' :
    prefix[0] === 0xfe && prefix[1] === 0xff ? 'utf-16be' : 'utf-8'
  let text: string
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    throw new Error('This file uses an unsupported text encoding. Save it as UTF-8 CSV or TSV and retry.')
  }
  return readDelimited(text, file.name, extension === 'tsv')
}
