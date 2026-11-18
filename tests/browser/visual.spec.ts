import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function importCsv(page: Page, name: string, data: string) {
  await page.goto('/#/import')
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(data) })
  await expect(page.getByRole('heading', { name: 'Review your columns' })).toBeVisible()
}

const build = (page: Page) => page.getByRole('button', { name: 'Build dashboard' })
const fit = (page: Page, width: number) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
const firstRegion = 'Northern distribution and customer operations'
const secondRegion = 'Northern distribution and field enablement'
const regions = [firstRegion, secondRegion, 'International operations', 'East sector', 'West sector', 'North sector', 'Domestic operations', 'Export', 'Distribution']

test('shows all category names and consistent chart placement across viewport changes', async ({ page }, info) => {
  await importCsv(page, 'long-regions.csv', ['Region,Revenue', ...regions.map((region, i) => `${region},${i === 4 ? -20 : 950 - i * 75}`)].join('\n'))
  await build(page).click()
  const bars = page.locator('.category-bars')
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(bars.locator('li')).toHaveCount(9)
    for (const region of [firstRegion, secondRegion]) {
      const label = bars.getByText(region, { exact: true })
      await expect(label).toBeVisible()
      expect(await label.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    }
    await fit(page, width)
    if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`regions-${width}.png`) })
  }
  await page.goto('/#/import')
  await page.getByRole('button', { name: /^Retail sales/ }).click()
  for (const width of [921, 920, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const trend = await page.locator('.trend-panel').boundingBox()
    const breakdown = await page.locator('.breakdown').boundingBox()
    expect(trend?.y).toBe(breakdown?.y)
    await fit(page, width)
  }
})

test('explains the partial week on keyboard and touch without covering the plot', async ({ page, browser, baseURL }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.preview-window .chart-frame > svg')).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: info.outputPath('landing-desktop.png'), animations: 'disabled' })
  await page.goto('/#/import')
  await page.getByRole('button', { name: /^Website traffic/ }).click()
  const frame = page.locator('.chart-frame')
  const message = /Mar 24.*Mar 25, 2025.*2 of 7 days observed/
  await expect(frame.locator('.chart-coverage')).toContainText(message)
  await expect(frame.locator('.partial-edge')).toHaveCount(2)
  await frame.focus()
  await page.keyboard.press('End')
  await expect(frame.locator('.chart-tooltip')).toContainText(message)
  await expect(frame.locator('.chart-tooltip')).toContainText('4,386')
  await expect(frame.locator('.chart-tooltip')).toContainText('10 records')
  await page.screenshot({ path: info.outputPath('traffic-desktop.png') })
  await page.keyboard.press('Escape')
  await expect(frame.locator('.chart-tooltip')).toHaveCount(0)
  await frame.locator('.partial-dot').last().hover()
  await expect(frame.locator('.chart-tooltip')).toContainText(message)
  await page.getByRole('button', { name: 'Bar chart' }).click()
  await expect(frame.locator('.partial-bar')).toHaveCount(2)

  const mobile = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  try {
    await mobile.goto('/#/import')
    await mobile.getByRole('button', { name: /^Website traffic/ }).tap()
    const chart = mobile.locator('.chart-frame')
    for (const width of [390, 320]) {
      await mobile.setViewportSize({ width, height: 844 })
      await expect(chart.locator('.chart-coverage')).toContainText(message)
      await expect(chart.locator('svg text').filter({ hasText: /^Mar 24$/ })).toBeVisible()
      await chart.locator('.partial-dot').last().tap()
      const readout = chart.locator('.chart-readout')
      await expect(readout).toContainText(message)
      await expect(readout).toBeInViewport({ ratio: 1 })
      expect((await readout.boundingBox())!.y).toBeGreaterThanOrEqual((await chart.locator('svg').boundingBox())!.y + (await chart.locator('svg').boundingBox())!.height)
      await fit(mobile, width)
      if (width === 390) await mobile.screenshot({ path: info.outputPath('traffic-touch.png') })
      await chart.locator('.partial-dot').last().tap()
      await expect(readout).toHaveCount(0)
    }
  } finally {
    await mobile.close()
  }
})

test('triages 38 columns on phones and keeps wide tables readable across viewports', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const headers = ['Notes', 'Region', 'Completion %', ...Array.from({ length: 33 }, (_, i) => `Attribute ${i + 1}`), 'Order date', 'Amount 36']
  const long = 'Check the shipment notes before approving the next workflow. '.repeat(4).trim()
  const rows = ['2025-01-01', '2025-01-02', '2025-02-31'].map((date, i) =>
    [long, regions[i], `${i * 10 + 25}%`, ...Array.from({ length: 33 }, (_, j) => (i + 2) * (j + 7)), date, (i + 3) * 7].join(','))
  await importCsv(page, 'wide-import.csv', [headers.join(','), ...rows].join('\n'))
  await expect(page.locator('.schema-compact')).toHaveCount(37)
  await expect(build(page)).toBeInViewport()
  await page.screenshot({ path: info.outputPath('wide-review.png') })
  await page.getByRole('button', { name: 'Review Order date' }).click()
  const issue = page.locator('.schema-row').filter({ has: page.getByRole('heading', { name: 'Order date' }) })
  await expect(issue).toBeFocused()
  await expect(issue.getByText('1 invalid', { exact: true })).toBeVisible()
  await expect(issue.getByText('2025-02-31', { exact: true })).toBeVisible()
  await expect(issue.getByText('—', { exact: true })).toBeVisible()
  await expect(build(page)).toBeInViewport()
  await page.getByRole('button', { name: 'Expand column Notes' }).click()
  const preview = page.locator('.schema-row').first().locator('.example-disclosure').first()
  await preview.locator('summary').click()
  await expect(preview.locator('p')).toHaveText(long)
  await build(page).click()
  await page.getByRole('button', { name: 'Data table', exact: true }).click()
  const table = page.getByRole('region', { name: 'Spreadsheet rows' })
  const identity = table.locator('.row-number').first()
  const initial = (await identity.boundingBox())!.x
  const longCell = table.locator('.table-cell-details').first()
  await longCell.locator('summary').click()
  await expect(longCell.locator('p')).toHaveText(long)
  await longCell.locator('summary').click()
  await page.getByRole('combobox', { name: 'Jump to column' }).selectOption({ label: 'Amount 36' })
  await expect.poll(() => table.evaluate(node => node.scrollLeft)).toBeGreaterThan(3000)
  expect((await identity.boundingBox())!.x).toBeCloseTo(initial, 0)
  await expect(table.getByRole('columnheader', { name: 'Amount 36' })).toBeInViewport()
  expect(await table.getByRole('cell', { name: '21', exact: true }).last().evaluate(node => getComputedStyle(node).textAlign)).toBe('right')
  await fit(page, 390)
  await page.screenshot({ path: info.outputPath('wide-table.png') })
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('combobox', { name: 'Jump to column' }).selectOption({ label: 'Attribute 33' })
    await expect(table.getByRole('button', { name: 'Attribute 33', exact: true })).toBeInViewport()
    for (const name of ['Region', 'Completion %', 'Attribute 33']) {
      const header = await table.getByRole('columnheader', { name, exact: true }).boundingBox()
      expect(header!.height).toBeLessThan(58)
      expect(header!.width).toBeGreaterThanOrEqual(128)
    }
    expect((await identity.boundingBox())!.x).toBeCloseTo((await table.boundingBox())!.x, 0)
    await fit(page, width)
    await page.screenshot({ path: info.outputPath(`wide-table-${width}.png`) })
    await page.getByRole('combobox', { name: 'Jump to column' }).selectOption({ label: 'Notes' })
  }
})

test('states sparse observation coverage even when both calendar boundaries are present', async ({ page }) => {
  await importCsv(page, 'sparse-traffic.csv', 'Date,Sessions\n2025-01-06,35\n2025-01-12,42\n2025-01-13,31\n2025-01-19,47')
  await build(page).click()
  await page.getByRole('combobox', { name: 'Date granularity' }).selectOption('week')
  await expect(page.locator('.partial-edge')).toHaveCount(0)
  await expect(page.locator('.chart-coverage')).toContainText('Dated records cover 2 of 7 days in 2 displayed weeks.')
  await page.locator('.chart-values summary').click()
  await expect(page.locator('.chart-values dl')).toContainText(/Jan 13.*Jan 19, 2025.*2 of 7 days observed/)
})

test('keeps a long filename inspectable and the leading metric readable on phones', async ({ page }, info) => {
  const filename = 'Customer acquisition and channel performance for the first quarter of 2025 - prepared for the Northwest reporting team.csv'
  await page.setViewportSize({ width: 390, height: 844 })
  await importCsv(page, filename, 'Date,Acquisition Channel,Conversion %,Sessions\n2025-01-01,Search,25%,100\n2025-01-02,Direct,35%,120\n2025-01-03,Email,50%,190')
  await build(page).click()
  await page.getByRole('combobox', { name: 'Metric', exact: true }).selectOption({ label: 'Conversion %' })
  const metric = page.locator('.featured-stat')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await fit(page, width)
    const value = metric.locator('summary strong')
    await expect(value).toHaveText('36.67%')
    expect(await value.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && getComputedStyle(node).whiteSpace === 'nowrap')).toBe(true)
    await expect(page.locator('.trend-panel .chart-frame > svg')).toBeInViewport({ ratio: 0.5 })
    if (width === 390) await page.screenshot({ path: info.outputPath('mobile-overview.png') })
  }
  await metric.locator('summary').click()
  await expect(metric.getByText(/Exact value 36\.666/)).toBeVisible()
  await page.locator('.dataset-source summary').click()
  await expect(page.getByText(filename, { exact: true })).toBeVisible()
  await importCsv(page, 'records.csv', 'Ticket ID,Notes\n0001,First note\n0002,Second note\n0003,Third note')
  await build(page).click()
  await expect(page.locator('.chart-frame')).toHaveCount(0)
  await page.getByRole('button', { name: 'View rows' }).click()
  await expect(page.getByRole('region', { name: 'Spreadsheet rows' })).toBeVisible()
})

test('recovers from invalid and conflicting conditions using the keyboard', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const plot = page.locator('.preview-window svg[viewBox]').filter({ has: page.locator('text') })
  await expect(plot).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('link', { name: 'Sample data', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('landing-phone.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Try sample data' }).click()
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const column = page.getByRole('combobox', { name: 'Filter column' })
  const value = page.getByRole('combobox', { name: 'Value', exact: true })
  const apply = page.getByRole('button', { name: 'Apply filter' })
  const result = page.getByRole('button', { name: 'View results' })
  await page.keyboard.press('Tab')
  await expect(column).toBeFocused()
  await expect(page.getByRole('combobox', { name: 'Combine conditions' })).toHaveCount(0)
  await apply.focus()
  await page.keyboard.press('Enter')
  await expect(value).toBeFocused()
  await expect(value).toHaveAttribute('aria-invalid', 'true')
  await expect(value).toHaveAccessibleDescription('Enter or choose a value.')
  await value.selectOption('West')
  await apply.click()
  await expect(result).toBeFocused()
  await value.selectOption('East')
  await apply.click()
  await expect(page.getByRole('combobox', { name: 'Combine conditions' })).toBeVisible()
  await expect(result).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#analysis-results')).toBeFocused()
  await expect(page.getByRole('heading', { name: 'No rows match these filters' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit filters' }).click()
  await expect(column).toBeFocused()
  await page.getByRole('button', { name: 'Clear all filters' }).click()
  await expect(page.getByRole('heading', { name: 'No rows match these filters' })).toHaveCount(0)
  await expect(page.locator('.chart-frame')).toBeVisible()
})
