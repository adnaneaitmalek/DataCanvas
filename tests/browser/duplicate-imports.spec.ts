import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { reviewHeading, showAllColumns } from './import-flow'

const csv = 'Date,Region,Revenue (USD)\n2025-01-01,West,10\n2025-01-02,East,20'
const heading = (page: Page, name = 'sales') => page.getByRole('heading', { name, exact: true })
const importLink = (page: Page) => page.getByRole('banner').getByRole('link', { name: 'Import', exact: true })
async function upload(page: Page, data = csv, name = 'sales.csv') {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(data) })
  await expect(page.locator('.workspace')).toBeVisible()
}

test('uploading the same CSV three times reopens one workspace with its analysis intact', async ({ page }) => {
  await page.goto('/#/import')
  await upload(page)
  const id = await page.evaluate(() => history.state.dataCanvasSession)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('combobox', { name: 'Value', exact: true }).selectOption('West')
  await page.getByRole('button', { name: 'Apply filter' }).click()
  await page.getByRole('button', { name: 'View results' }).click()
  await page.getByRole('button', { name: 'Data table', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search rows' }).fill('West')
  for (let repeat = 0; repeat < 2; repeat++) {
    await importLink(page).click()
    await upload(page)
    expect(await page.evaluate(() => history.state.dataCanvasSession)).toBe(id)
    await expect(page.getByRole('searchbox', { name: 'Search rows' })).toHaveValue('West')
    await expect(page.getByText('1 of 2 rows', { exact: true })).toBeVisible()
    await expect(page.getByText('Reopened saved analysis. Your filters and column settings are preserved.')).toBeVisible()
  }
  await page.reload()
  await importLink(page).click()
  await expect(page.locator('.recent-work li')).toHaveCount(1)
  await upload(page, csv, 'sales-copy.csv')
  expect(await page.evaluate(() => history.state.dataCanvasSession)).toBe(id)
  await expect(heading(page)).toBeVisible()
})

test('a changed CSV with the same name and size remains a separate dataset', async ({ page }) => {
  await page.goto('/#/import')
  await upload(page)
  const id = await page.evaluate(() => history.state.dataCanvasSession)
  await importLink(page).click()
  await upload(page, csv.replace('West,10', 'West,30'))
  expect(await page.evaluate(() => history.state.dataCanvasSession)).not.toBe(id)
  await expect(page.locator('.featured-stat')).toContainText('$50.00')
  await importLink(page).click()
  await expect(page.locator('.recent-work li')).toHaveCount(2)
})

test('reuploading a file awaiting review keeps its saved interpretation choices', async ({ page }) => {
  await page.goto('/#/import')
  const file = { name: 'uncertain.csv', mimeType: 'text/csv', buffer: Buffer.from('Date;Revenue (EUR)\n02/03/2025;1,234\n04/05/2025;2,345') }
  await page.locator('input[type=file]').setInputFiles(file)
  await expect(reviewHeading(page)).toBeVisible()
  const id = await page.evaluate(() => history.state.dataCanvasSession)
  await page.getByRole('combobox', { name: 'Date format', exact: true }).selectOption('dmy')
  await page.getByRole('button', { name: 'Back to import', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(file)
  await expect(reviewHeading(page)).toBeVisible()
  expect(await page.evaluate(() => history.state.dataCanvasSession)).toBe(id)
  await showAllColumns(page, false)
  await expect(page.getByRole('combobox', { name: 'Date format', exact: true })).toHaveValue('dmy')
  await page.getByRole('combobox', { name: 'Number format', exact: true }).selectOption('dot')
  await page.getByRole('button', { name: 'Open dashboard', exact: true }).click()
  await expect(page.locator('.featured-stat')).toContainText('€3,579.00')
  await importLink(page).click()
  await expect(page.locator('.recent-work li')).toHaveCount(1)
})

test('consolidates older duplicate listings without losing history and removes the whole listing cleanly', async ({ page }) => {
  await page.goto('/#/import')
  await upload(page)
  await page.getByRole('button', { name: 'Data table', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search rows' }).fill('West')
  await importLink(page).click()
  await page.reload()
  await expect(page.locator('.recent-work li')).toHaveCount(1)
  // Recreate three entries written by the previous release, which had no file identity.
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('datacanvas-workspaces', 1)
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const transaction = database.transaction(['workspaces', 'content'], 'readwrite')
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    const index = transaction.objectStore('workspaces')
    const content = transaction.objectStore('content')
    const read = (store: IDBObjectStore) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const result = store.getAll()
      result.onsuccess = () => resolve(result.result[0])
      result.onerror = () => reject(result.error)
    })
    const [original, file] = await Promise.all([read(index), read(content)])
    index.clear()
    content.clear()
    for (let i = 1; i <= 3; i++) {
      const id = `legacy-${i}`
      index.put({ ...original, id, fingerprint: undefined, updated: i, hasDashboard: i !== 3 })
      content.put({ ...file, id })
    }
    await done
    database.close()
  })
  await page.reload()
  await expect(page.locator('.recent-work li')).toHaveCount(1)
  await page.locator('.recent-open').click()
  await expect(page.getByRole('searchbox', { name: 'Search rows' })).toHaveValue('West')
  expect(await page.evaluate(() => history.state.dataCanvasSession)).toBe('legacy-2')
  await page.goBack()
  await page.evaluate(() => {
    history.pushState({ dataCanvasSession: 'legacy-1' }, '', '#/dashboard')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByRole('searchbox', { name: 'Search rows' })).toHaveValue('West')
  await page.goBack()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Remove sales', exact: true }).click()
  await expect(page.locator('.recent-work li')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.recent-work li')).toHaveCount(0)
})

test('page headings keep navigation focus without a box while keyboard controls retain focus rings', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Start analyzing' }).press('Enter')
  await expect(heading(page, 'Import a spreadsheet')).toBeFocused()
  expect(await heading(page, 'Import a spreadsheet').evaluate(node => getComputedStyle(node).outlineStyle)).toBe('none')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Choose file' })).toBeFocused()
  expect(await page.getByRole('button', { name: 'Choose file' }).evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid')
  await page.goto('/#/dashboard')
  await expect(heading(page, 'Reopen a workspace')).toBeFocused()
  expect(await heading(page, 'Reopen a workspace').evaluate(node => getComputedStyle(node).outlineStyle)).toBe('none')
})
