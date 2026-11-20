import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { showAllColumns } from './import-flow'

const heading = (page: Page, title: string) => page.getByRole('heading', { name: title, exact: true })
const shell = (page: Page) => page.getByRole('banner')
const motionCount = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('.site-shell .brand, .site-shell nav, .shell-workspaces, main')]
    .flatMap(node => node.getAnimations()).length)
const finishMotion = (page: Page) => page.evaluate(() => {
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish()
  }
})

test('keeps one header and animates its edges without scaling text or blocking rapid navigation', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')
  const header = await shell(page).elementHandle()
  const brand = shell(page).getByRole('link', { name: 'DataCanvas home' })
  const before = (await brand.boundingBox())!.x
  // Capture deterministic frames of actual Chrome animations, without a timing-based sleep.
  await page.getByRole('button', { name: 'Try sample data' }).evaluate(element => (element as HTMLButtonElement).click())
  await expect(heading(page, 'Retail sales')).toBeVisible()
  expect(await motionCount(page)).toBeGreaterThan(0)
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 80 }
  })
  const middle = (await brand.boundingBox())!.x
  const destination = (await page.locator('.workspace').boundingBox())!.x
  expect(middle).toBeLessThan(before)
  expect(middle).toBeGreaterThan(destination)
  expect(await brand.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).a)).toBe(1)
  await page.screenshot({ path: info.outputPath('header-expanding.png') })
  // A second navigation interrupts a paused transition instead of waiting for it.
  await shell(page).getByRole('link', { name: 'Import', exact: true }).evaluate(element => (element as HTMLAnchorElement).click())
  await expect(heading(page, 'Import a spreadsheet')).toBeVisible()
  await finishMotion(page)
  expect(await header!.evaluate(node => node === document.querySelector('header'))).toBe(true)
  await shell(page).getByRole('link', { name: 'Dashboard', exact: true }).click()
  await finishMotion(page)
  const workspace = (await page.locator('.workspace').boundingBox())!
  expect((await brand.boundingBox())!.x).toBeCloseTo(workspace.x, 0)
  const navigation = (await shell(page).getByRole('navigation').boundingBox())!
  const headerBox = (await page.locator('.site-shell-inner').boundingBox())!
  expect(navigation.x + navigation.width / 2).toBeCloseTo(headerBox.x + headerBox.width / 2, 0)
  await expect(shell(page).getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(shell(page).getByRole('link', { name: 'How it works' })).toHaveCount(0)
  await expect(page).toHaveTitle('Retail sales · DataCanvas')
  await page.screenshot({ path: info.outputPath('workspace-header.png') })
  await page.goBack()
  await expect(heading(page, 'Import a spreadsheet')).toBeVisible()
  await page.goForward()
  await expect(heading(page, 'Retail sales')).toBeVisible()
})

test('contextual navigation returns to the same filtered workspace and keeps unapplied edits', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try sample data' }).click()
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('combobox', { name: 'Value', exact: true }).selectOption('West')
  await page.getByRole('button', { name: 'Apply filter' }).click()
  await page.getByRole('button', { name: 'View results' }).click()
  await page.getByRole('button', { name: 'Data table', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search rows' }).fill('ORD-')
  await page.getByRole('link', { name: 'Edit columns', exact: true }).click()
  await expect(shell(page).getByText('Column settings', { exact: true })).toHaveAttribute('aria-current', 'page')
  await showAllColumns(page, false)
  await page.getByRole('combobox', { name: 'Number format', exact: true }).selectOption('comma')
  await shell(page).getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Spreadsheet rows' })).toBeFocused()
  await expect(page.getByRole('searchbox', { name: 'Search rows' })).toHaveValue('ORD-')
  await expect(page.getByText('200 of 480 rows', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Resume column edits' })).toBeVisible()
  await page.goForward()
  await expect(heading(page, 'Edit columns')).toBeFocused()
  await showAllColumns(page, false)
  await expect(page.getByRole('combobox', { name: 'Number format', exact: true })).toHaveValue('comma')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await shell(page).getByRole('link', { name: 'Import', exact: true }).click()
  await shell(page).getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Search rows' })).toHaveValue('ORD-')
  await expect(page.getByText('200 of 480 rows', { exact: true })).toBeVisible()
})

for (const mode of ['reduced motion', 'no animation API'] as const) {
  test(`navigation stays immediate and functional with ${mode}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    if (mode === 'reduced motion') await page.emulateMedia({ reducedMotion: 'reduce' })
    else await page.addInitScript(() => Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true }))
    await page.goto('/')
    await page.getByRole('button', { name: 'Try sample data' }).click()
    await expect(heading(page, 'Retail sales')).toBeFocused()
    expect(await motionCount(page)).toBe(0)
    await page.getByRole('link', { name: 'Edit columns', exact: true }).click()
    await expect(heading(page, 'Edit columns')).toBeFocused()
    expect(await motionCount(page)).toBe(0)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goBack()
    await expect(heading(page, 'From spreadsheet to dashboard.')).toBeFocused()
    expect(errors).toEqual([])
  })
}

test('keyboard import and touch navigation retain focus and fit small screens', async ({ page, browser, baseURL }, info) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Start analyzing' }).press('Enter')
  await expect(heading(page, 'Import a spreadsheet')).toBeFocused()
  expect(await motionCount(page)).toBe(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('input[type=file]').setInputFiles({ name: 'ambiguous.csv', mimeType: 'text/csv', buffer: Buffer.from('Date;Revenue (EUR)\n02/03/2025;12\n04/05/2025;20') })
  await expect(heading(page, 'Review your import')).toBeFocused()
  expect(await motionCount(page)).toBe(0)
  let checkedInput = false
  for (let index = 0; index < 16; index++) {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const node = document.activeElement!
      const footer = document.querySelector('.review-footer')!
      return { footer: footer.contains(node), checkbox: node.tagName === 'INPUT',
        bottom: node.getBoundingClientRect().bottom, limit: footer.getBoundingClientRect().top }
    })
    if (focused.footer) break
    checkedInput ||= focused.checkbox
    expect(focused.bottom).toBeLessThanOrEqual(focused.limit)
  }
  expect(checkedInput).toBe(true)
  await page.getByRole('combobox', { name: 'Date format', exact: true }).selectOption('dmy')
  await page.getByRole('button', { name: 'Open dashboard', exact: true }).press('Enter')
  await expect(heading(page, 'ambiguous')).toBeFocused()
  expect(await motionCount(page)).toBe(0)

  const mobile = await browser.newPage({ baseURL, viewport: { width: 320, height: 844 }, hasTouch: true, isMobile: true })
  try {
    await mobile.goto('/')
    await mobile.getByRole('button', { name: 'Try sample data' }).tap()
    await mobile.getByRole('link', { name: 'Edit columns', exact: true }).tap()
    for (const width of [320, 390, 768]) {
      await mobile.setViewportSize({ width, height: 844 })
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await expect(shell(mobile).getByRole('link', { name: 'DataCanvas home' })).toBeInViewport({ ratio: 1 })
      await expect(mobile.locator('.workspace-menu summary')).toBeInViewport({ ratio: 1 })
    }
    await mobile.setViewportSize({ width: 390, height: 844 })
    await mobile.screenshot({ path: info.outputPath('review-phone.png') })
    await mobile.getByRole('button', { name: 'Cancel', exact: true }).tap()
    await expect(heading(mobile, 'Retail sales')).toBeVisible()
  } finally {
    await mobile.close()
  }
})
