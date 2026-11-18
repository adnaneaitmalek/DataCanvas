import { describe, expect, it } from 'vitest'
import { utils, write } from '@e965/xlsx'
import { defaultMetric, filterRows, groupRows, partitionDate, recommendedAggregation, total } from '../src/data/analyze'
import { chartCsv, csv } from '../src/data/export'
import { parseDate, parseNumber, profile } from '../src/data/infer'
import { readDelimited, readSource } from '../src/data/import'
import { defaultSettings, limits, validateFile } from '../src/data/model'
import { loadSample, samples } from '../src/data/samples'
import { readWorkbook } from '../src/data/workbook'

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

  it('selects workbook tabs and preserves formatted dates, percentages, currencies and identifiers', () => {
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
    const source = readWorkbook(buffer, 'regions.xlsx')
    expect(source.sheet).toBe('North')
    expect(source.sheets).toEqual(['Cover', 'North', 'South'])
    expect(source.rows[0]).toEqual(['2025-02-17', '24.5%', '€ 1250.25', '00073', 10, null])
    expect(source.notices.join(' ')).toMatch(/error cell.*Formula cells/)
    expect(profile(source).rows[0]).toEqual(['2025-02-17', 24.5, 1250.25, '00073', 10, null])
    expect(readWorkbook(buffer, 'regions.xlsx', 'South').rows).toEqual([['South']])
    expect(() => readWorkbook(buffer, 'regions.xlsx', 'Cover')).toThrow('No usable data')
    expect(() => readWorkbook(new ArrayBuffer(26), 'broken.xlsx')).toThrow('not a readable')
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
  })

  it('handles locale separators and rejects malformed or ambiguous numeric strings', () => {
    expect(parseNumber('(1 234,50)', 'auto')).toBe(-1234.5)
    expect(parseNumber("1'234.50", 'auto')).toBe(1234.5)
    expect(parseNumber('1,250,000', 'auto')).toBe(1250000)
    expect(parseNumber('1.234', 'auto')).toBeNull()
    expect(parseNumber('1,2,3', 'auto')).toBeNull()
    expect(parseNumber('4.01e-3', 'auto')).toBeCloseTo(0.00401)
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
    const west = { column: 1, value: 'West', min: '', max: '' }
    const jan = { column: 0, value: '', min: '2025-01-01', max: '2025-01-31' }
    expect(filterRows(dataset, [west, jan])).toHaveLength(2)
    expect(filterRows(dataset, [west, jan, { column: 2, value: '', min: '10', max: '' }])).toEqual([dataset.rows[0]])
    expect(filterRows(dataset, [west, jan, { column: 2, value: '', min: '', max: '', missing: true }])).toEqual([dataset.rows[2]])
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
  })

  it('aggregates large supported sheets without discarding records', () => {
    const n = limits.rows
    const input = 'ID\tRegion\tUnits sold\n' + Array.from({ length: n }, (_, i) => `SKU-${i}\t${i % 2 ? 'East' : 'West'}\t3`).join('\n')
    const large = profile(readDelimited(input, 'orders.tsv', true))
    expect(large.rows).toHaveLength(n)
    expect(total(large.rows, defaultMetric(large.columns)).value).toBe(n * 3)
  })
})
