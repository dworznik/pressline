import { expect, test } from '@playwright/test'

/** What a Customer sees and does, end to end, against the seeded bridge. */
test('design page: brand, product photo overlay, quote, print file, checkout, thank-you, status', async ({
  page,
}) => {
  await page.goto('/order/sample/sunset-1')
  await expect(page.locator('[data-brand]')).toContainText('E2E Shop')
  await expect(page.locator('footer.legal')).toContainText('Terms')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunset study')
  await expect(page.locator('[data-mockup="preview"]')).toBeVisible()

  await page.getByRole('button', { name: 'Black / M' }).click()
  await expect(page.locator('[data-mockup="overlay"]')).toBeVisible()
  await expect(page.locator('figcaption')).toContainText('Illustrative')
  await expect(page.locator('[data-printfile="ready"]')).toBeVisible()
  await expect(page.locator('[data-withdrawal]')).toContainText('made to your design')

  await page.getByLabel('Ship to').selectOption('DE')
  await expect(page.locator('[data-quote="ready"]')).toContainText('Total')
  await expect(page.locator('[data-quote="ready"]')).toContainText('€29.79')

  await page.getByRole('button', { name: 'Continue to payment' }).click()
  await page.waitForURL(/\/orders\/[0-9a-f-]+\/thank-you\?t=/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you!')
  await expect(page.getByText('We are confirming your payment')).toBeVisible()

  await page.getByRole('link', { name: 'Track this order' }).click()
  await page.waitForURL(/\/orders\/[0-9a-f-]+\?t=/)
  await expect(page.locator('main.status')).toContainText('Black tee, front print')
  await expect(page.locator('main.status')).toContainText('Order')
})

test('preparing: a slow Engine shows progress until the print file is ready', async ({ page }) => {
  await page.goto('/order/sample/sunset-slow')
  await page.getByRole('button', { name: 'Black / M' }).click()
  await expect(page.locator('[data-printfile="preparing"]')).toBeVisible()
  await expect(page.locator('[data-printfile="ready"]')).toBeVisible({ timeout: 15_000 })
})

test('an Engine-supplied mockup replaces the overlay', async ({ page }) => {
  await page.goto('/order/sample/sunset-mockup')
  await page.getByRole('button', { name: 'Black / M' }).click()
  await expect(page.locator('[data-mockup="engine"]')).toHaveAttribute(
    'src',
    'https://files.e2e/sunset-on-tee.png',
  )
  await expect(page.locator('figcaption')).toContainText('from the design app')
})

test('unknown design is a friendly 404', async ({ page }) => {
  const res = await page.goto('/order/sample/nope')
  expect(res?.status()).toBe(404)
  await expect(page.locator('main.error')).toContainText('could not find that design')
})
