import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function navigate(page, name) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
}

const countryCount = (page) => page.locator('.kpi').first().locator('.kpi-value');

test('secondary country analytics remains accessible and fits the viewport', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?view=countries');
  await expect(page.getByRole('heading', { name: 'Countries Analytics' })).toBeVisible();
  await expect(countryCount(page)).toHaveText('250');
  await expect(page.locator('.country-density-chart .recharts-bar-rectangle')).toHaveCount(8);
  await expect(page.locator('.country-region-pie .recharts-pie-sector').first()).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.locator('.country-source-row')).toContainText('Repository snapshot');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && innerWidth <= screen.width)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('countries.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('regional pie filters population without turning density into a share', async ({ page }) => {
  await page.goto('/?view=countries');
  await expect(countryCount(page)).toHaveText('250');
  await page.locator('.country-region-pie .recharts-pie-sector').first().click();
  await expect(page.getByLabel('Region', { exact: true })).not.toHaveValue('');
  await expect(countryCount(page)).not.toHaveText('250');
  await page.getByRole('button', { name: 'Clear country filters', exact: true }).click();
  await expect(countryCount(page)).toHaveText('250');
  await page.getByRole('button', { name: 'Density', exact: true }).click();
  await expect(page.locator('.country-region-pie')).toHaveCount(0);
  await expect(page.locator('.country-region-bars .bar-fill')).toHaveCount(6);
});

test('region, population, currency and language filters work with chart toggles', async ({ page }) => {
  await page.goto('/?view=countries');
  await expect(countryCount(page)).toHaveText('250');
  await page.getByRole('button', { name: 'Density', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Density by region' })).toBeVisible();
  await page.getByRole('button', { name: 'Filter region Europe', exact: true }).click();
  await expect(page.getByLabel('Region', { exact: true })).toHaveValue('Europe');
  await expect(countryCount(page)).toHaveText('53');
  await page.getByLabel('Minimum population', { exact: true }).fill('10000000');
  await page.getByLabel('Maximum population', { exact: true }).fill('100000000');
  await expect(countryCount(page)).toHaveText('14');
  await page.getByRole('button', { name: 'Clear country filters', exact: true }).click();
  await expect(countryCount(page)).toHaveText('250');
  await page.getByRole('button', { name: 'Filter currency EUR', exact: true }).click();
  await expect(page.getByLabel('Country currency', { exact: true })).toHaveValue('EUR');
  await expect(countryCount(page)).toHaveText('36');
  await page.getByRole('button', { name: 'Clear country filters', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('eng');
  await expect(countryCount(page)).not.toHaveText('250');
  await expect(page.locator('.kpi-value').first()).not.toHaveClass(/skeleton/);
  await expect(page).toHaveURL(/country_language=eng/);
});

test('country pagination, search, detail and border drill-down work', async ({ page }) => {
  await page.goto('/?view=countries');
  await expect(countryCount(page)).toHaveText('250');
  await page.locator('.country-density-chart .recharts-bar-rectangle').first().click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Macau', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Monaco density details', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Monaco', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Next country page', exact: true })).toBeEnabled();
  const first = await page.locator('.country-name-button').first().textContent();
  await page.getByRole('button', { name: 'Next country page', exact: true }).click();
  await expect(page.locator('.country-name-button').first()).not.toHaveText(first);
  await page.getByLabel('Sort countries', { exact: true }).selectOption('name_asc');
  await expect(page.locator('.country-name-button').first()).toContainText('Afghanistan');
  await page.getByLabel('Search countries', { exact: true }).fill('Canada');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open Canada', exact: true }).click();
  const detail = page.getByRole('dialog');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Canada', exact: true })).toBeVisible();
  await expect(detail).toContainText('CAD');
  await expect(detail).toContainText('English');
  await expect(detail).toContainText('French');
  await detail.getByRole('button', { name: 'United States', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'United States', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Search countries', { exact: true }).fill('no-such-country');
  await expect(page.getByRole('heading', { name: 'No countries found' })).toBeVisible();
});

test('export downloads all 250 countries across API pages', async ({ page }) => {
  await page.goto('/?view=countries');
  await expect(countryCount(page)).toHaveText('250');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^countries-.*\.csv$/);
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv.split('\r\n')).toHaveLength(251);
  expect(csv).toContain('"CAN","Canada"');
});

test('country and commerce views preserve independent filters', async ({ page }) => {
  await page.goto('/?view=countries');
  await expect(countryCount(page)).toHaveText('250');
  await page.getByLabel('Region', { exact: true }).selectOption('Asia');
  await expect(page).toHaveURL(/country_region=Asia/);
  await navigate(page, 'Dashboard');
  await expect(page.getByRole('heading', { name: 'Commerce Analytics Dashboard' })).toBeVisible();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  await page.locator('#category').selectOption('Electronics');
  await expect(page).toHaveURL(/country_region=Asia/);
  await navigate(page, 'Countries');
  await expect(page).toHaveURL(/view=countries/);
  await expect(page.getByLabel('Region', { exact: true })).toHaveValue('Asia');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Countries Analytics' })).toBeVisible();
  await expect(page.getByLabel('Region', { exact: true })).toHaveValue('Asia');
  await navigate(page, 'Dashboard');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Commerce Analytics Dashboard' })).toBeVisible();
  await expect(page.locator('#category')).toHaveValue('Electronics');
  await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('$2,200.00');
});

test('country API error can be retried and live sync reports imported countries', async ({ page }) => {
  await page.route('**/api/analytics/countries/summary**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Country storage unavailable' } }) }));
  await page.goto('/?view=countries');
  await expect(page.getByRole('heading', { name: 'Unable to load countries' })).toBeVisible();
  await page.unroute('**/api/analytics/countries/summary**');
  await page.getByRole('button', { name: 'Retry countries', exact: true }).click();
  await expect(countryCount(page)).toHaveText('250');
  await page.route('**/api/ingest/countries?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { persisted: true, imported: 250, skipped: 0, warnings: [], source: 'live_api' } }) }));
  await page.getByRole('button', { name: 'Sync API', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('250 countries imported from REST Countries API');
  await expect(countryCount(page)).toHaveText('250');
});
