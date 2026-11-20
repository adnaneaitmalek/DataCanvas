import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { utils, write } from '@e965/xlsx'
import { acceptExclusions, finishImport, reviewAction, reviewHeading, waitForImport } from './import-flow'

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true })
const edit = async (page: Page) => {
  await page.getByRole('link', { name: 'Edit columns' }).click()
}
const apply = (page: Page) => page.getByRole('button', { name: 'Apply changes' }).click()
const build = (page: Page) => reviewAction(page).click()
const reopen = (page: Page, label: string) => page.locator('.recent-work').getByRole('button', { name: label, exact: true }).click()

async function csv(page: Page, name: string, text: string) {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })
  await waitForImport(page)
}

test('finishes setup and returns from repeated edits without extra back steps', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Start analyzing' }).click()
  const uncertain = 'Region,Revenue\nWest,12\nEast,bad'
  await csv(page, 'orders.csv', uncertain)
  await expect(reviewHeading(page)).toBeVisible()
  await page.getByRole('button', { name: 'Back to import' }).click()
  await expect(page).toHaveURL(/#\/import$/)
  await csv(page, 'orders.csv', uncertain)
  await acceptExclusions(page)
  await build(page)
  await expect(heading(page, 'orders')).toBeFocused()
  await page.goBack()
  await expect(page).toHaveURL(/#\/import$/)
  await page.goForward()
  await expect(heading(page, 'orders')).toBeVisible()

  const length = await page.evaluate(() => history.length)
  for (let cycle = 0; cycle < 2; cycle++) {
    await edit(page)
    await expect(heading(page, 'Edit columns')).toBeFocused()
    await expect(page.locator('.review-context')).toContainText('orders')
    await apply(page)
    await expect(heading(page, 'orders')).toBeVisible()
  }
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(length + 1)
  await page.goBack()
  await expect(page).toHaveURL(/#\/import$/)
  await page.goForward()
  await expect(heading(page, 'orders')).toBeVisible()
  await page.goForward()
  await expect(heading(page, 'orders')).toBeVisible()
  await expect(page).toHaveURL(/#\/dashboard$/)
  await page.goBack()
  await expect(page).toHaveURL(/#\/import$/)
  await reopen(page, 'orders 2 rows')
  await edit(page)
  await page.getByRole('button', { name: 'Change file' }).click()
  await expect(page).toHaveURL(/#\/import$/)
  await reopen(page, 'orders 2 rows')
  await expect(heading(page, 'orders')).toBeVisible()
})

test('returns to the same workbook after cancelling or applying a worksheet change', async ({ page }, info) => {
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([['Region', 'Revenue (EUR)'], ['West', 12.5]]), 'January')
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([['Region', 'Revenue (EUR)'], ['East', 25.5]]), 'February')
  await page.goto('/#/import')
  await page.locator('input[type=file]').setInputFiles({
    name: 'quarters.xlsx', mimeType: 'application/octet-stream', buffer: write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  })
  await build(page)
  await expect(heading(page, 'January')).toBeVisible()
  await page.reload()
  await expect(heading(page, 'January')).toBeVisible()
  await edit(page)
  const picker = page.getByRole('combobox', { name: 'Worksheet' })
  await picker.press('Space')
  await expect.poll(() => picker.evaluate(element => element.matches(':open'))).toBe(true)
  await page.screenshot({ path: info.outputPath('worksheet-picker.png') })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(picker).toHaveValue('February')
  await page.goBack()
  await expect(heading(page, 'January')).toBeVisible()
  await page.goForward()
  await expect(heading(page, 'Edit columns')).toBeVisible()
  await expect(picker).toHaveValue('February')
  await apply(page)
  await expect(heading(page, 'February')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/#\/import$/)
  await page.goForward()
  await expect(heading(page, 'February')).toBeVisible()
})

test('restores a wide table after both Cancel and browser Back', async ({ page }) => {
  const headers = ['Record ID', 'Region', ...Array.from({ length: 36 }, (_, i) => `Attribute ${i + 1}`)]
  const data = Array.from({ length: 60 }, (_, i) =>
    [`A-${String(i + 1).padStart(3, '0')}`, i % 2 ? 'East' : 'West', ...Array(36).fill(i * 2)].join(','))
  await page.goto('/#/import')
  await csv(page, 'wide-matrix.csv', [headers.join(','), ...data].join('\n'))
  await finishImport(page)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('combobox', { name: 'Value', exact: true }).selectOption('West')
  await page.getByRole('button', { name: 'Apply filter' }).click()
  await page.getByRole('button', { name: 'View results' }).click()
  await page.getByRole('button', { name: 'Data table', exact: true }).click()
  const search = page.getByRole('searchbox', { name: 'Search rows' })
  await search.fill('A-')
  await page.getByRole('button', { name: 'Next page' }).click()
  const jump = page.getByRole('combobox', { name: 'Jump to column' })
  await jump.selectOption('Attribute 35')
  const table = page.getByRole('region', { name: 'Spreadsheet rows' })
  const left = await table.evaluate(element => element.scrollLeft)
  expect(left).toBeGreaterThan(2500)
  const download = async () => {
    await page.locator('.export-menu summary').click()
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Table results (CSV)' }).click()])
    return readFile(await file.path(), 'utf8')
  }
  const before = await download()
  for (const via of ['Cancel', 'Back']) {
    await edit(page)
    if (via === 'Cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    else await page.goBack()
    await expect(table).toBeFocused()
    await expect(search).toHaveValue('A-')
    await expect(page.getByText('26–30 of 30 rows')).toBeVisible()
    await expect(jump).toHaveValue('Attribute 35')
    await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeCloseTo(left, 0)
    expect(await download()).toBe(before)
  }
})

test('keeps an unavailable link and workspace switcher readable on narrow screens', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 820 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Try sample data' }).click()
  await page.getByRole('link', { name: 'Import', exact: true }).click()
  const current = page.locator('.workspace-menu summary')
  await expect(current).toBeInViewport({ ratio: 1 })
  await page.getByRole('button', { name: /^Warehouse inventory/ }).click()
  await expect(heading(page, 'Warehouse inventory')).toBeVisible()
  await page.reload()
  await expect(heading(page, 'Warehouse inventory')).toBeVisible()
  await page.goto('/#/import')
  await page.goto('/#/dashboard')
  await expect(page).toHaveURL(/#\/recover$/)
  await expect(heading(page, 'Reopen a workspace')).toBeFocused()
  await expect(page.getByRole('status')).toContainText('This workspace is unavailable.')
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 820 })
    await expect(current).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'Reopen spreadsheet' })).toBeInViewport({ ratio: 1 })
    expect(await page.locator('.recovery-notice > div').evaluate(node => node.clientWidth)).toBeGreaterThan(225)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: info.outputPath(`recovery-${width}.png`) })
  }
  await current.click()
  await page.locator('.workspace-choices').getByRole('button', { name: /^Warehouse inventory/ }).click()
  await expect(heading(page, 'Warehouse inventory')).toBeVisible()
  await page.setViewportSize({ width: 320, height: 820 })
  await page.reload()
  await expect(heading(page, 'Warehouse inventory')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
})
