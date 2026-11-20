import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export const reviewHeading = (page: Page) => page.getByRole('heading', { name: 'Review your import', exact: true })
export const reviewAction = (page: Page) => page.getByRole('button', { name: /^(Open dashboard|Use shown values|Apply changes)$/ })
export const editColumns = (page: Page) => page.getByRole('link', { name: 'Edit columns', exact: true })

export async function waitForImport(page: Page) {
  await expect(reviewHeading(page).or(page.locator('.workspace'))).toBeVisible()
}

export async function showAllColumns(page: Page, expand = true) {
  const show = page.getByRole('button', { name: /^Show all \d+ columns$/ })
  if (await show.isVisible()) await show.click()
  if (expand) {
    const toggles = page.getByRole('button', { name: /^Expand column / })
    while (await toggles.count()) await toggles.first().click()
  }
}

export async function acceptExclusions(page: Page) {
  const choices = page.locator('.interpretation-choice input:not(:checked)')
  while (await choices.count()) await choices.first().check()
}

export async function finishImport(page: Page) {
  await waitForImport(page)
  if (await reviewHeading(page).isVisible()) await reviewAction(page).click()
  await expect(page.locator('.workspace')).toBeVisible()
}
