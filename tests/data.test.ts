import { describe, expect, it } from 'vitest'
import { utils, write } from '@e965/xlsx'
import { defaultMetric, groupRows, partitionDate, recommendedAggregation, total } from '../src/data/analyze'
import { chartCsv, csv, typedCsv } from '../src/data/export'
import { filterRows, parseFilter } from '../src/data/filters'
import type { Filter } from '../src/data/filters'
import { parseDate, parseNumber, profile } from '../src/data/infer'
import { readDelimited, readSource } from '../src/data/import'
import { defaultSettings, formatValue, limits, sourceValue, validateFile } from '../src/data/model'
import { loadSample, samples } from '../src/data/samples'
import { readWorkbook } from '../src/data/workbook'
import { chartLayout } from '../src/ui/chartLayout'
import { imagePdf } from '../src/ui/pdfImage'

describe('spreadsheet import', () => {
  it('keeps quoted commas and multiline cells while reporting malformed rows', () => {
    const source = readDelimited('\uFEFFDate,Region,Revenue,Note\r\n2025-01-02,West,24,"Meet, greet\r\nand sell"\r\n2025-01-03,East,30\r\n2025-01-04,West,42,OK,extra\r\n,,,' + '\r\n', 'orders.csv')
    expect(source.rows).toEqual([
      ['2025-01-02', 'West', '24', 'Meet, greet\r\nand sell'],
      ['2025-01-03', 'East', '30', null],
    ])
    expect(source.notices).toEqual(['1 short row was padded with missing cells.', '1 row with extra fields was skipped.'])
  })

  it('handles semicolon CSV, TSV, single columns and blank or duplicate headers', () => {
    expect(readDelimited('Team;Amount\nDesign;15,20\nOps;21,40', 'expenses.csv').rows[0]).toEqual(['Design', '15,20'])
    expect(readDelimited('ID\tName\tname\t\n001\tSam\tPark\tyes', 'list.tsv', true).headers).toEqual(['ID', 'Name', 'name (2)', 'Column 4'])
    expect(readDelimited('Amount\n3\n4', 'single.csv').rows).toEqual([['3'], ['4']])
  })

  it('honors Excel separator directives and preserves quoted records across chunks', () => {
    expect(readDelimited('\uFEFFsep=;\r\nDate;Spending\r\n2025-02-14;23,45', 'excel.csv').rows)
      .toEqual([['2025-02-14', '23,45']])
    const note = 'Service notes\nPaid, in full'
    const record = 'A,Regular invoice description\n'
    const header = 'ID,Note\n'
    const body = record.repeat(4368) + 'A,' + 'x'.repeat(128 * 1024 - header.length - 4368 * record.length - 12) + '\n'
    const source = readDelimited(`${header}${body}B,"${note}"\nC,Last`, 'notes.csv')
    expect(source.rows).toHaveLength(4371)
    expect(source.rows.at(-2)).toEqual(['B', note])
    expect(source.rows.at(-1)).toEqual(['C', 'Last'])
    expect(() => readDelimited('ID,Note\nA,' + 's'.repeat(limits.cellLength + 1), 'long.csv')).toThrow('32,767')
  })

  it('fails on invalid quotes, missing body, bad encodings and oversized input', async () => {
    expect(() => readDelimited('a,b\n1,"unclosed', 'broken.csv')).toThrow('Invalid quoting')
    expect(() => readDelimited('a,b', 'headers.csv')).toThrow('No usable data')
    expect(() => validateFile('file.xls', 9)).toThrow('Older .xls')
    expect(() => validateFile('large.xlsx', limits.bytes + 1)).toThrow('15 MB')
    expect(() => readDelimited('Value\n' + '1\n'.repeat(limits.rows + 1), 'large.csv')).toThrow('100,000')
    const aFile = new File([Uint8Array.of(0xff, 0xfd)], 'legacy.csv')
    await expect(readSource(aFile)).rejects.toThrow('unsupported text encoding')
  })

  it('reads UTF-16 TSV exports with a byte order mark', async () => {
    const encoded = Uint16Array.from([0xfeff, ...Array.from('City\tCount\nMontréal\t23', ch => ch.charCodeAt(0))])
    const source = await readSource(new File([encoded], 'city.tsv'))
    expect(source.rows).toEqual([['Montréal', '23']])
  })

  it('selects workbook tabs and preserves formatted dates, percentages, currencies and identifiers', async () => {
    const book = utils.book_new()
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Header']]), 'Cover')
    const sheet = utils.aoa_to_sheet([
      ['Date', 'Completion', 'Spend', 'Store ID', 'Cached', 'Error'],
      [new Date(2025, 1, 17, 12), 0.245, 1250.25, 73, 10, 1],
    ], { cellDates: true })
    sheet.B2.z = '0.0%'
    sheet.C2.z = '"€"#,##0.00'
    sheet.D2.z = '00000'
    sheet.E2.f = 'SUM(7,3)'
    sheet.F2 = { t: 'e', v: 7 }
    utils.book_append_sheet(book, sheet, 'North')
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Region'], ['South']]), 'South')
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Ignored'], ['Hidden']]), 'Archive')
    utils.book_set_sheet_visibility(book, 'Archive', 1)
    const buffer = write(book, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer
    const source = await readWorkbook(buffer, 'regions.xlsx')
    expect(source.sheet).toBe('North')
    expect(source.sheets).toEqual(['Cover', 'North', 'South'])
    expect(source.rows[0].map(sourceValue)).toEqual(['2025-02-17', '24.5%', 'EUR 1250.25', '00073', 10, null])
    expect(source.notices.join(' ')).toMatch(/error cell.*Formula cells/)
    expect(profile(source).rows[0]).toEqual(['2025-02-17', 24.5, 1250.25, '00073', 10, null])
    expect(profile(source, {}, { dateOrder: 'dmy', numberStyle: 'comma' }).rows[0])
      .toEqual(['2025-02-17', 24.5, 1250.25, '00073', 10, null])
    expect((await readWorkbook(buffer, 'regions.xlsx', 'South')).rows).toEqual([['South']])
    await expect(readWorkbook(buffer, 'regions.xlsx', 'Cover')).rejects.toThrow('No usable data')
    await expect(readWorkbook(new ArrayBuffer(26), 'broken.xlsx')).rejects.toThrow('not a readable')
  })

  it('interprets the 1904 date system and keeps time-only cells out of dates', async () => {
    const sheet = utils.aoa_to_sheet([['Date', 'Clock', 'Price'], [1, 0.5, 1.234], [2, 0, -0.125]])
    for (const row of [2, 3]) {
      sheet[`A${row}`].z = 'yyyy-mm-dd'
      sheet[`B${row}`].z = 'hh:mm'
      sheet[`C${row}`].z = '[$CHF-807] #,##0.000'
    }
    const book = utils.book_new()
    book.Workbook = { WBProps: { date1904: true } }
    utils.book_append_sheet(book, sheet, 'Calendar')
    const source = await readWorkbook(write(book, { type: 'array' }) as ArrayBuffer, '1904.xlsx')
    const normalized = profile(source, {}, { dateOrder: 'mdy', numberStyle: 'comma' })
    expect(normalized.rows).toEqual([['1904-01-02', '12:00', 1.234], ['1904-01-03', '00:00', -0.125]])
    expect(normalized.columns[2].unit).toBe('CHF')
  })

  it('rejects inconsistent ZIP directory and local entry metadata', async () => {
    const book = utils.book_new()
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Total'], [4]]), 'Data')
    const buffer = write(book, { type: 'array' }) as ArrayBuffer
    const view = new DataView(buffer)
    view.setUint32(22, view.getUint32(22, true) + 1, true)
    await expect(readWorkbook(buffer, 'corrupt.xlsx')).rejects.toThrow(/not a readable/)
  })

  it('checks expanded ZIP data against the sizes declared by both headers', async () => {
    const book = utils.book_new()
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Total'], [4]]), 'Data')
    const buffer = write(book, { type: 'array', compression: true }) as ArrayBuffer
    const view = new DataView(buffer)
    const central = view.getUint32(view.byteLength - 6, true)
    expect(view.getUint16(central + 10, true)).toBe(8)
    const offset = view.getUint32(central + 42, true)
    const size = view.getUint32(central + 24, true) + 1
    view.setUint32(central + 24, size, true)
    view.setUint32(offset + 22, size, true)
    await expect(readWorkbook(buffer, 'inconsistent.xlsx')).rejects.toThrow(/not a readable/)
  })

  it('rejects an altered workbook entry even when its record length is unchanged', async () => {
    const book = utils.book_new()
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Total'], [4]]), 'Data')
    const buffer = write(book, { type: 'array' }) as ArrayBuffer
    const view = new DataView(buffer)
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true)
    view.setUint8(start, view.getUint8(start) ^ 1)
    await expect(readWorkbook(buffer, 'checksum.xlsx')).rejects.toThrow(/not a readable/)
  })
})

describe('column inference', () => {
  it('uses column evidence without stripping leading zeros or inventing dates', () => {
    const source = readDelimited('Order ID;Order date;Amount (EUR);Completion %;Region\n0019;31/01/2025;€1.249,40;22,5%;West\n0020;02/01/2025;1.234;(10%);East\n0021;30/02/2025;NA;;;', 'sales.csv')
    const result = profile(source)
    expect(result.columns.map(column => column.kind)).toEqual(['identifier', 'date', 'currency', 'percent', 'category'])
    expect(result.rows[0]).toEqual(['0019', '2025-01-31', 1249.4, 22.5, 'West'])
    expect(result.rows[1].slice(0, 3)).toEqual(['0020', '2025-01-02', 1234])
  })

  it('flags ambiguous dates and separators and reinterprets them explicitly', () => {
    const source = readDelimited('Date;Amount\n01/03/2025;1,200\n02/05/2025;2,120', 'ambiguous.csv')
    const detected = profile(source)
    expect(detected.columns.map(column => [column.kind, column.invalid])).toEqual([['date', 2], ['number', 2]])
    const corrected = profile(source, {}, { dateOrder: 'dmy', numberStyle: 'dot' })
    expect(corrected.rows).toEqual([['2025-03-01', 1200], ['2025-05-02', 2120]])
    expect(parseDate('2025-02-29', 'auto')).toBeNull()
    expect(parseDate('2024-02-29', 'auto')).toBe('2024-02-29')
    expect(parseDate('2024-02-29T29:00Z', 'auto')).toBeNull()
    expect(parseDate('2024-02/29', 'auto')).toBeNull()
    expect(parseDate('2024-02-29T23:29:00+25:00', 'auto')).toBeNull()
    expect(parseDate('2024-02-29T23:29:00-06:00', 'auto')).toBe('2024-02-29')
    expect(parseDate('18 Nov 2026', 'auto')).toBe('2026-11-18')
  })

  it('handles locale separators and rejects malformed or ambiguous numeric strings', () => {
    expect(parseNumber('(1 234,50)', 'auto')).toBe(-1234.5)
    expect(parseNumber("1'234.50", 'auto')).toBe(1234.5)
    expect(parseNumber('1,250,000', 'auto')).toBe(1250000)
    expect(parseNumber('1.234', 'auto')).toBeNull()
    expect(parseNumber('1,2,3', 'auto')).toBeNull()
    expect(parseNumber('4.01e-3', 'auto')).toBeCloseTo(0.00401)
    expect(parseNumber('12,34,567.50', 'auto')).toBe(1234567.5)
    expect(parseNumber('١٬٢٣٤٫٥٠', 'comma')).toBe(1234.5)
    expect(parseNumber('1e-400', 'auto')).toBeNull()
    expect(parseNumber('9007199254740993', 'auto')).toBeNull()
    expect(formatValue(0.00000046)).not.toBe('0')
  })

  it('keeps mixed currencies as text or excludes incompatible units on manual override', () => {
    const mixed = readDelimited('Spend\n"$12.50"\n"€14.80"\n"USD 14.00"', 'mixed.csv')
    expect(profile(mixed).columns[0].kind).toBe('text')
    const edited = profile(mixed, { 0: { kind: 'currency', unit: 'USD' } }, defaultSettings)
    expect(edited.rows).toEqual([[12.5], [null], [14]])
    expect(edited.columns[0].invalid).toBe(1)
  })

  it('uses the selected percentage scale for plain values and keeps explicit percentages as written', () => {
    const source = readDelimited('Completion %\n0.25\n50%\n(10%)\n0', 'completion.csv')
    expect(profile(source).rows).toEqual([[0.25], [50], [-10], [0]])
    expect(profile(source, { 0: { kind: 'percent', percentScale: 'fraction' } }).rows).toEqual([[25], [50], [-10], [0]])
  })

  it('labels inferred currency and percentage units in normalized table exports', () => {
    const original = profile(readDelimited('Change;Cost;Reference\n2.4%;EUR 12.3456;00001', 'units.csv'))
    expect(typedCsv(original.columns, original.rows)).toBe('\uFEFFChange (%),Cost (EUR),Reference\r\n2.4,12.3456,00001')
  })

  it('preserves long identifiers and recognizes accounting and non-dollar currencies', () => {
    const source = readDelimited('Reference;Amount (CHF);Buyer\n900719925474099312;CHF 15.43;NA\n000889; (CHF 4.38) ;Rabat', 'ledger.csv')
    const typed = profile(source)
    expect(typed.columns.map(column => column.kind)).toEqual(['identifier', 'currency', 'category'])
    expect(typed.rows).toEqual([['900719925474099312', 15.43, 'NA'], ['000889', -4.38, 'Rabat']])
    const conflicting = profile(readDelimited('Spend (USD)\nUSD 4.20\nNZD 5.90', 'mixed.csv'))
    expect(conflicting.columns[0]).toMatchObject({ kind: 'text', note: expect.stringContaining('currency') })
  })
})

describe('aggregation, filtering, and exports', () => {
  const dataset = profile(readDelimited('Date;Region;Revenue (USD);Bounce rate (%)\n2025-01-01;West;12;20\n2025-01-04;East;5;61\n2025-01-20;West;;40\n2025-02-01;West;-4;92\n;East;10;', 'analysis.csv'))

  it('computes sums, averages, valid counts, zeros and missing groups independently', () => {
    const revenue = { column: 2, aggregation: 'sum' } as const
    expect(total(dataset.rows, revenue)).toMatchObject({ value: 23, valid: 4, records: 5 })
    expect(total(dataset.rows, { column: 3, aggregation: 'average' })).toMatchObject({ value: 53.25, valid: 4 })
    expect(total([[0]], { column: 0, aggregation: 'sum' }).value).toBe(0)
    expect(total([[null]], { column: 0, aggregation: 'sum' }).value).toBeNull()
    const result = groupRows(dataset.rows, revenue, dataset.columns[0], 'month')
    expect(result).toEqual({ groups: [
      { key: '2025-01-01', value: 17, valid: 2, records: 3 },
      { key: '2025-02-01', value: -4, valid: 1, records: 1 },
    ], excluded: 1 })
    expect(partitionDate('2025-01-01', 'week')).toBe('2024-12-30')
    expect(partitionDate('2025-08-21', 'quarter')).toBe('2025-07-01')
    expect(recommendedAggregation(dataset.columns[3])).toBe('average')
  })

  it('combines exact category, dates, missing and numerical filters', () => {
    const west: Filter = { column: 1, operator: 'eq', value: 'West' }
    const jan: Filter = { column: 0, operator: 'between', value: '2025-01-01', end: '2025-01-31' }
    expect(filterRows(dataset, [west, jan])).toHaveLength(2)
    expect(filterRows(dataset, [west, jan, { column: 2, operator: 'gte', value: 10 }])).toEqual([dataset.rows[0]])
    expect(filterRows(dataset, [west, jan, { column: 2, operator: 'missing' }])).toEqual([dataset.rows[2]])
    expect(filterRows(dataset, [west, { column: 0, operator: 'missing' }], 'any')).toEqual([0, 2, 3, 4].map(index => dataset.rows[index]))
    expect(filterRows(dataset, [{ column: 2, operator: 'neq', value: 5 }])).toEqual([0, 3, 4].map(index => dataset.rows[index]))
    expect(() => parseFilter({ column: 2, operator: 'between', value: '7', end: '2' }, dataset.columns[2])).toThrow(/lower bound/)
    expect(() => parseFilter({ column: 2, operator: 'lte', value: 'broken', end: '' }, dataset.columns[2])).toThrow(/valid number/)
  })

  it('retains small values during cancellation and excludes nonfinite values', () => {
    const rows = [[9007199254740990], [0.125], [-9007199254740990], [NaN], [Infinity]]
    expect(total(rows, { column: 0, aggregation: 'sum' })).toMatchObject({ value: 0.125, valid: 3, records: 5 })
    expect(total(rows, { column: 0, aggregation: 'average' }).value).toBeCloseTo(0.125 / 3)
    const unusable = profile(readDelimited('Order date;Revenue (USD)\n01/02/2025;wrong\n03/02/2025;invalid', 'bad-amount.csv'))
    expect(defaultMetric(unusable.columns, unusable.rows.length)).toEqual({ column: null, aggregation: 'count' })
  })

  it('uses meaningful defaults across the five datasets, including snapshots and surveys', () => {
    const expected = ['Revenue (USD)', 'Amount (USD)', 'Sessions', 'Units on hand', 'Satisfaction score']
    expect(samples.map((sample, index) => {
      const { dataset } = loadSample(sample.id)
      const metric = defaultMetric(dataset.columns)
      expect(dataset.rows).toHaveLength(sample.rows)
      expect(dataset.columns[metric.column!].name).toBe(expected[index])
      expect(total(dataset.rows, metric).value).toBeGreaterThan(0)
      return metric.aggregation
    })).toEqual(['sum', 'sum', 'sum', 'sum', 'average'])
  })

  it('quotes fields, preserves negative numbers and protects CSV text from spreadsheet formula interpretation', () => {
    expect(csv(['a,b', '=header'], [['hello "you"', '=SUM(1,2)'], [-3, null]]))
      .toBe('\uFEFF"a,b",\'=header\r\n"hello ""you""","\'=SUM(1,2)"\r\n-3,')
    expect(chartCsv('Month', 'Total sales', [{ key: '2025-01-01', value: -4, records: 2, valid: 1 }], 'USD'))
      .toBe('\uFEFFMonth,Total sales (USD),Records,Valid values\r\n2025-01-01,-4,2,1')
    expect(csv(['Amount'], [['-230.12'], ['-2+4']])).toBe("\uFEFFAmount\r\n-230.12\r\n'-2+4")
    expect(csv(['Text'], [[' \u200B＝1+4']])).toBe("\uFEFFText\r\n' \u200B＝1+4")
    expect(chartCsv('Records', 'Records', [])).toBe('\uFEFFRecords,Records (2),Records (3),Valid values')
  })

  it('aggregates large supported sheets without discarding records', () => {
    const n = limits.rows
    const input = 'ID\tRegion\tUnits sold\n' + Array.from({ length: n }, (_, i) => `SKU-${i}\t${i % 2 ? 'East' : 'West'}\t3`).join('\n')
    const large = profile(readDelimited(input, 'orders.tsv', true))
    expect(large.rows).toHaveLength(n)
    expect(total(large.rows, defaultMetric(large.columns)).value).toBe(n * 3)
  })
})

describe('dashboard outputs', () => {
  it('preserves signed chart positions and breaks the line at unobserved intervals', () => {
    const data = [
      { key: '2025-01-01', value: -6, records: 1, valid: 1 },
      { key: '2025-02-01', value: 0, records: 1, valid: 1 },
      { key: '2025-04-01', value: 7, records: 1, valid: 1 },
    ]
    const plot = chartLayout({ data, type: 'line', period: 'month', title: 'Net sales' }, 600, 300)
    expect(plot.points[0].y).toBeGreaterThan(plot.zero)
    expect(plot.points[1].y).toBe(plot.zero)
    expect(plot.points[2].y).toBeLessThan(plot.zero)
    expect(plot.segments.map(segment => segment.length)).toEqual([2, 1])
  })

  it('writes PDF cross-reference offsets in bytes, including binary JPEG content', async () => {
    const fakeJpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
    const bytes = new Uint8Array(await imagePdf(fakeJpeg, 2400, 1500).arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes)
    const xref = Number(/startxref\n(\d+)/.exec(text)?.[1])
    expect(text.slice(xref, xref + 4)).toBe('xref')
    const entries = text.slice(xref).split('\n').slice(3, 8)
    for (const [index, entry] of entries.entries()) {
      const offset = Number(entry.slice(0, 10))
      expect(text.slice(offset, offset + 7)).toBe(`${index + 1} 0 obj`)
    }
  })
})
