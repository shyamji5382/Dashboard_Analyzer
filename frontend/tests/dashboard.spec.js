import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openNavigation(page, label) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label, exact: true }).click();
}

test('dashboard loads real data, renders charts and fits the viewport', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Commerce Analytics Dashboard' })).toBeVisible();
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('$2,800.00');
  await expect(page.locator('.kpi').nth(3).locator('.kpi-value')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Filter On time deliveries', exact: true })).toContainText('0');
  await expect(page.getByRole('button', { name: 'Filter Unknown deliveries', exact: true })).toContainText('1');
  await expect(page).toHaveTitle('Commerce Analytics Dashboard');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button')).toHaveText(['Dashboard', 'Orders', 'Data sources3', 'Countries']);
  await expect(page.locator('.trend-chart .recharts-area-curve')).toBeVisible();
  await expect(page.locator('.trend-chart .recharts-bar-rectangle')).toHaveCount(2);
  await expect(page.locator('.donut-chart .recharts-pie-sector').first()).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const fit = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && window.innerWidth <= window.screen.width);
  expect(fit).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('trend and delivery charts support assignment drill-down', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  await page.getByRole('button', { name: 'Filter revenue on Jan 1, 2024', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Start date', { exact: true })).toHaveValue('2024-01-01');
  await expect(page.getByLabel('End date', { exact: true })).toHaveValue('2024-01-01');
  await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('$2,200.00');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  // The revenue point crosses this bar's center; select its exposed upper body.
  await page.getByRole('button', { name: 'Filter orders on Jan 2, 2024', exact: true }).click({ position: { x: 13, y: 12 } });
  await expect(page.getByLabel('Start date', { exact: true })).toHaveValue('2024-01-02');
  await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('$600.00');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  await page.getByRole('button', { name: 'Filter orders on Jan 1, 2024', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Start date', { exact: true })).toHaveValue('2024-01-01');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('1');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  await page.locator('.donut-chart .recharts-pie-sector').first().click();
  await expect(page.locator('#delivery-status')).toHaveValue('delayed');
  await expect(page.locator('.kpi').nth(3).locator('.kpi-value')).toHaveText('1');
});

test('filters, toggles, small-dataset pagination and assignment drill-down work', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  await page.getByRole('button', { name: 'Orders', exact: true }).filter({ hasNot: page.locator('svg') }).click();
  await expect(page.getByRole('heading', { name: 'Orders over time' })).toBeVisible();
  await page.getByRole('button', { name: 'Revenue', exact: true }).click();
  await page.getByRole('button', { name: 'Filter Electronics', exact: true }).click();
  await expect(page.locator('#category')).toHaveValue('Electronics');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('1');
  await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('$2,200.00');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.locator('#category').selectOption('Furniture');
  await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('$600.00');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Search orders' }).fill('1001');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '1001', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Line items' })).toBeVisible();
  const detail = page.getByRole('dialog');
  await expect(detail).toContainText('Customer C001');
  await expect(detail).toContainText('Laptop');
  await expect(detail).toContainText('Qty 2');
  await expect(detail).toContainText('$2,200.00');
  await expect(detail).toContainText('S001');
  await expect(detail).toContainText('3 days');
  await expect(detail).toContainText('Delivered');
  await expect(detail).toContainText('on-time arrival is unknown');
  await expect(detail).not.toContainText('Awaiting delivery');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search orders' }).fill('no-such-customer');
  await expect(page.getByRole('heading', { name: 'No orders found' })).toBeVisible();
});

test('date and delivery filters apply and export downloads all matching orders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  const allOrdersDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const allOrdersCsv = await readFile(await (await allOrdersDownload).path(), 'utf8');
  expect(allOrdersCsv.split('\r\n')).toHaveLength(3);
  expect(allOrdersCsv).toContain('"1001"');
  expect(allOrdersCsv).toContain('"1002"');
  await page.getByLabel('Start date', { exact: true }).fill('2024-01-02');
  await page.getByLabel('End date', { exact: true }).fill('2024-01-02');
  await page.locator('#delivery-status').selectOption('delayed');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).not.toHaveClass(/skeleton/);
  await expect(page.locator('tbody tr').first().locator('.status-badge')).toHaveText('Delayed');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^commerce-orders-.*\.csv$/);
});

test('source view imports the original assignment exports and refreshes records', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  await openNavigation(page, 'Data sources');
  await expect(page.getByRole('heading', { name: 'Connected sources' })).toBeVisible();
  await page.getByLabel('Upload Orders', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toContainText('Invalid JSON');
  const orders = await readFile(new URL('../../backend/data/originals/Orders.json', import.meta.url));
  await page.getByLabel('Upload Orders', { exact: true }).setInputFiles({ name: 'Orders.json', mimeType: 'application/json', buffer: orders });
  await expect(page.getByRole('status')).toContainText('2 records imported');
  await expect(page.getByRole('status')).toContainText('3 line items');
  const products = await readFile(new URL('../../backend/data/originals/Products.csv', import.meta.url));
  await page.getByLabel('Upload Products', { exact: true }).setInputFiles({ name: 'Products.csv', mimeType: 'text/csv', buffer: products });
  await expect(page.getByRole('status')).toContainText('3 records imported');
  const shipments = await readFile(new URL('../../backend/data/originals/Shipments.xml', import.meta.url));
  await page.getByLabel('Upload Shipments', { exact: true }).setInputFiles({ name: 'Shipments.xml', mimeType: 'application/xml', buffer: shipments });
  await expect(page.getByRole('status')).toContainText('2 records imported');
  await expect(page.getByRole('status')).not.toContainText('3 line items');
  await page.getByRole('button', { name: 'Load bundled orders', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('2 records imported');
  await openNavigation(page, 'Dashboard');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
  await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('$2,800.00');
  await expect(page.locator('.kpi').nth(3).locator('.kpi-value')).toHaveText('1');
  await expect(page).not.toHaveURL(/view=/);
});

test('commerce is the fallback, legacy links still work, and the brand returns home', async ({ page }) => {
  for (const url of ['/?view=overview', '/?view=unrecognized']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Commerce Analytics Dashboard', exact: true })).toBeVisible();
    await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('$2,800.00');
  }
  await openNavigation(page, 'Countries');
  await expect(page).toHaveURL(/view=countries/);
  await expect(page.getByRole('heading', { name: 'Countries Analytics', exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Commerce Analytics Dashboard', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/view=/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Commerce Analytics Dashboard', exact: true })).toBeVisible();
});

test('an unavailable secondary API does not block the commerce dashboard', async ({ page }) => {
  await page.route('**/api/analytics/countries/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Country storage unavailable' } }) }));
  await page.goto('/');
  await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('$2,800.00');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await openNavigation(page, 'Countries');
  await expect(page.getByRole('heading', { name: 'Unable to load countries' })).toBeVisible();
  await openNavigation(page, 'Dashboard');
  await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('$2,800.00');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('API failures offer retry and recover', async ({ page }) => {
  await page.route('**/api/analytics/summary?**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Storage unavailable' } }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Unable to load analytics' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Storage unavailable');
  await page.unroute('**/api/analytics/summary?**');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('2');
});
