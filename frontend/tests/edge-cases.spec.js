import { expect, test } from '@playwright/test';

const revenue = (page) => page.locator('.kpi-value').first();

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function openDashboard(page) {
  await page.goto('/');
  await expect(revenue(page)).toHaveText('$2,800.00');
  await expect(page.locator('tbody tr')).toHaveCount(2);
}

test('slow API requests show initial loading states and recover', async ({ page }) => {
  const gate = deferred();
  await page.route('**/api/analytics/**', async (route) => {
    await gate.promise;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.kpi-value.skeleton')).toHaveCount(4);
    await expect(page.getByRole('status').filter({ hasText: 'Loading analytics' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Loading orders' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh data', exact: true })).toBeDisabled();
  } finally {
    gate.resolve();
  }
  await expect(revenue(page)).toHaveText('$2,800.00');
  await expect(page.locator('.kpi-value.skeleton')).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('table-only API failure leaves analytics usable and retry restores rows', async ({ page }) => {
  await page.route('**/api/analytics/orders?**', (route) => route.fulfill({
    status: 503, json: { error: { message: 'Orders temporarily unavailable' } },
  }));
  await page.goto('/');
  await expect(revenue(page)).toHaveText('$2,800.00');
  await expect(page.getByRole('heading', { name: 'Revenue over time' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Orders temporarily unavailable');
  await page.unroute('**/api/analytics/orders?**');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('missing order details can be closed and reopened without breaking the dashboard', async ({ page }) => {
  const pattern = '**/api/analytics/orders/1001?**';
  await page.route(pattern, (route) => route.fulfill({ status: 404, json: { error: { message: 'Order no longer exists' } } }));
  await openDashboard(page);
  await page.getByRole('button', { name: '1001', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Order no longer exists');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.unroute(pattern);
  await page.getByRole('button', { name: '1001', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Line items' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Laptop');
  await page.keyboard.press('Escape');
  await expect(revenue(page)).toHaveText('$2,800.00');
});

test('closing a loading detail dialog cancels the request and never reopens it', async ({ page }) => {
  await openDashboard(page);
  const gate = deferred();
  const entered = deferred();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const pattern = '**/api/analytics/orders/1001?**';
  await page.route(pattern, async (route) => {
    entered.resolve();
    await gate.promise;
    await route.fulfill({ status: 503, json: { error: { message: 'Late response' } } }).catch(() => {});
  });
  try {
    await page.getByRole('button', { name: '1001', exact: true }).click();
    await entered.promise;
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('Loading order');
    const cancelled = page.waitForEvent('requestfailed', (request) => request.url().includes('/analytics/orders/1001?'));
    await page.keyboard.press('Escape');
    await cancelled;
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    gate.resolve();
  }
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
  await expect(revenue(page)).toHaveText('$2,800.00');
});

for (const failure of ['network', 'non-json-error', 'invalid-json-success']) {
  test(`${failure} API response shows a recoverable error instead of a blank screen`, async ({ page }) => {
    const pattern = '**/api/analytics/summary?**';
    await page.route(pattern, (route) => failure === 'network' ? route.abort('failed') : route.fulfill({
      status: failure === 'non-json-error' ? 502 : 200, contentType: 'text/html', body: '<html>Not JSON</html>',
    }));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Unable to load analytics' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(failure === 'network' ? 'Unable to reach the analytics API' :
      failure === 'non-json-error' ? 'Request failed (502)' : 'The API returned an invalid response');
    await page.unroute(pattern);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(revenue(page)).toHaveText('$2,800.00');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('rapid filter changes cancel stale summary and table requests', async ({ page }) => {
  await openDashboard(page);
  const gate = deferred();
  const entered = deferred();
  const captured = new Set();
  const responses = {};
  for (const endpoint of ['summary', 'orders']) {
    responses[endpoint] = await (await page.request.get(`/api/analytics/${endpoint}?category=Electronics`)).json();
  }
  const pattern = '**/api/analytics/**';
  await page.route(pattern, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('category') !== 'Electronics') return route.continue();
    const endpoint = url.pathname.endsWith('/summary') ? 'summary' : 'orders';
    captured.add(endpoint);
    if (captured.size === 2) entered.resolve();
    await gate.promise;
    await route.fulfill({ json: responses[endpoint] }).catch(() => {});
  });
  try {
    await page.locator('#category').selectOption('Electronics');
    await entered.promise;
    const cancelled = page.waitForEvent('requestfailed', (request) => request.url().includes('/summary?') &&
      new URL(request.url()).searchParams.get('category') === 'Electronics');
    await page.locator('#category').selectOption('Furniture');
    await cancelled;
    await expect(revenue(page)).toHaveText('$600.00');
    await expect(page.locator('tbody .order-id')).toHaveText('1002');
  } finally {
    gate.resolve();
  }
  await page.unrouteAll({ behavior: 'wait' });
  await expect(revenue(page)).toHaveText('$600.00');
  await expect(page.locator('#category')).toHaveValue('Furniture');
  await expect(page.locator('tbody .order-id')).toHaveText('1002');
});

test('reversed dates show validation and clearing filters restores real data', async ({ page }) => {
  await openDashboard(page);
  await page.getByLabel('Start date', { exact: true }).fill('2024-01-02');
  await page.getByLabel('End date', { exact: true }).fill('2024-01-01');
  await expect(page.getByRole('alert').filter({ hasText: 'Start date must be on or before end date.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unable to load analytics' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(revenue(page)).toHaveText('$2,800.00');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contradictory filters show an empty dataset without NaN or an invented rate', async ({ page }) => {
  await openDashboard(page);
  await page.locator('#category').selectOption('Electronics');
  await page.locator('#delivery-status').selectOption('delayed');
  await expect(revenue(page)).toHaveText('$0.00');
  await expect(page.locator('.kpi-value').nth(1)).toHaveText('0');
  await expect(page.getByRole('heading', { name: 'No orders found' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Delivery performance', exact: true })).toContainText('On-time rate: N/A');
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.kpi-grid')).not.toContainText('NaN');
});

test('failed export produces no partial download and a later export succeeds', async ({ page }) => {
  await openDashboard(page);
  const pattern = '**/api/analytics/orders?**';
  await page.route(pattern, (route) => new URL(route.request().url()).searchParams.get('page_size') === '100' ?
    route.fulfill({ status: 503, json: { error: { message: 'Export unavailable' } } }) : route.continue());
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Export unavailable');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  expect(downloads).toHaveLength(0);
  await page.unroute(pattern);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await pending).suggestedFilename()).toMatch(/^commerce-orders-.*\.csv$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(downloads).toHaveLength(1);
});
