import Papa from 'papaparse'
import { delimiterLabels, integer, limits, sourceValue, validateFile } from './model'
import type { Delimiter, Source, SourceCell } from './model'

type ImportMetadata = Omit<Source, 'headers' | 'rows'>

export function toSource(matrix: SourceCell[][], metadata: ImportMetadata, strictWidth = false): Source {
  const populated = matrix.filter(row => row.some(value => value !== null && String(sourceValue(value)).trim() !== ''))
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
    const original = String(sourceValue(header[i]) ?? '').trim()
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
  const rows: SourceCell[][] = []
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

function detectSeparator(text: string): NonNullable<Source['dialect']> {
  const sample = text.slice(0, 128 * 1024)
  let selected: Delimiter = ','
  let best = -1
  const plausible: Delimiter[] = []
  for (const delimiter of Object.keys(delimiterLabels) as Delimiter[]) {
    const { data: [header, ...rows], errors } = Papa.parse<string[]>(sample, { delimiter, preview: 33, skipEmptyLines: 'greedy' })
    if (!header || header.length <= 1) continue
    const consistent = rows.filter(row => row.length === header.length).length
    const confidence = rows.length === 0 ? 1 : consistent / rows.length
    // A truncated sample can end in a quoted field. Earlier quote errors still count against the delimiter.
    const score = confidence - (errors.some(error => error.type === 'Quotes' && (error.row ?? 0) < rows.length) ? 1 : 0)
    if (score >= 0.9 && consistent > 0) plausible.push(delimiter)
    if (score > best) {
      selected = delimiter
      best = score
    }
  }
  return { delimiter: selected, ambiguous: plausible.length > 1 ? plausible : [] }
}

export function readDelimited(text: string, filename: string, tsv = false, preferred?: Delimiter): Source {
  if (text.includes('\u0000')) throw new Error('This text file contains invalid characters. Save it as a UTF-8 CSV or TSV and try again.')
  text = text.replace(/^\uFEFF/, '')
  const directive = !tsv ? /^sep=([,;|\t])(?:\r\n|\n|\r)/i.exec(text) : null
  if (directive) text = text.slice(directive[0].length)
  const fixed = preferred ?? (tsv ? '\t' : directive?.[1] as Delimiter | undefined)
  const dialect = fixed ? { delimiter: fixed, ambiguous: [] } : detectSeparator(text)
  const matrix: string[][] = []
  let problem: string | undefined
  // Papa's StringStreamer supports chunk callbacks for decoded strings as well.
  const options: Papa.ParseConfig<string[]> & { chunkSize: number; chunk: (result: Papa.ParseResult<string[]>, parser: Papa.Parser) => void } = {
    delimiter: dialect.delimiter,
    chunkSize: 128 * 1024,
    skipEmptyLines: 'greedy',
    chunk(result, parser) {
      const quotes = result.errors.find(error => error.type === 'Quotes')
      if (quotes) {
        problem = `Invalid quoting near data record ${matrix.length + (quotes.row ?? 0) + 1}. Fix the quotes in the file and try again.`
      } else {
        for (const row of result.data) {
          matrix.push(row)
          const width = matrix[0].length
          if (width > limits.columns) problem = `This sheet has more than ${limits.columns} columns. Remove unused columns and retry.`
          else if (matrix.length > limits.rows + 1) problem = 'This file exceeds 100,000 data rows. Split it into smaller files and try again.'
          else if ((matrix.length - 1) * width > limits.cells) problem = 'This sheet exceeds 1,000,000 cells. Split it into smaller files.'
          if (problem) break
        }
      }
      if (problem) parser.abort()
    },
  }
  Papa.parse<string[]>(text, options)
  if (problem) throw new Error(problem)
  return toSource(matrix, { filename, notices: [], dialect }, true)
}

export async function readSource(file: File, sheet?: string, delimiter?: Delimiter): Promise<Source> {
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
  return readDelimited(text, file.name, extension === 'tsv', delimiter)
}
