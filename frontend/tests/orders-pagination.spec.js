import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Browser-only fixtures never pass through ingestion or reach the SQLite database.
const orders = Array.from({ length: 205 }, (_, index) => ({
  order_id: `TEST-${String(205 - index).padStart(4, '0')}`,
  order_date: '2024-01-01', customer_name: `Fixture customer ${205 - index}`,
  original_currency: 'USD', currency: 'USD', total_value: 10, revenue_complete: true,
  delivery_status: index % 2 ? 'delayed' : 'on_time', reported_delivery_status: '',
  items: [{ product_id: 'TEST-P1', name: 'Fixture product', category: index % 2 ? 'Furniture' : 'Electronics',
    quantity: 1, unit_price: 10, original_currency: 'USD', line_total: 10, image_url: '' }],
}));

function matchingOrders(url) {
  const params = url.searchParams;
  const search = (params.get('search') || '').toLowerCase();
  return orders.filter((order) =>
    (!params.get('category') || order.items[0].category === params.get('category')) &&
    (!params.get('delivery_status') || order.delivery_status === params.get('delivery_status')) &&
    (!params.get('start_date') || order.order_date >= params.get('start_date')) &&
    (!params.get('end_date') || order.order_date <= params.get('end_date')) &&
    (!search || order.order_id.toLowerCase().includes(search) || order.customer_name.toLowerCase().includes(search)));
}

async function mockOrders(page) {
  const requests = [];
  await page.route('**/api/analytics/filters', (route) => route.fulfill({ json: { data: {
    categories: ['Electronics', 'Furniture'], currencies: ['USD'], imports: [],
    dataset_counts: { orders: 205, products: 1, shipments: 0 },
  } } }));
  await page.route('**/api/analytics/summary?**', (route) => {
    const selected = matchingOrders(new URL(route.request().url()));
    const onTime = selected.filter((order) => order.delivery_status === 'on_time').length;
    return route.fulfill({ json: { data: {
      metrics: { total_orders: selected.length, total_revenue: selected.length * 10, average_order_value: selected.length ? 10 : 0,
        delayed_orders: selected.length - onTime, on_time_orders: onTime, on_time_rate: null, currency: 'USD' },
      revenue_trend: [], category_revenue: [], delivery_performance: [],
      period: { start_date: '2024-01-01', end_date: '2024-01-01' },
    }, meta: { data_quality: {}, exchange_rates: [] } } });
  });
  await page.route('**/api/analytics/orders?**', (route) => {
    const url = new URL(route.request().url());
    const selected = matchingOrders(url);
    const pageNumber = Number(url.searchParams.get('page'));
    const pageSize = Number(url.searchParams.get('page_size'));
    requests.push({ page: pageNumber, pageSize, category: url.searchParams.get('category') });
    return route.fulfill({ json: {
      data: selected.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      pagination: { page: pageNumber, page_size: pageSize, total: selected.length, total_pages: Math.ceil(selected.length / pageSize) },
      meta: {},
    } });
  });
  return requests;
}

test('commerce pagination visits every order and filters reset the current page', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('205');
  await expect(page.locator('tbody tr')).toHaveCount(8);
  await page.getByLabel('Rows per page', { exact: true }).selectOption('30');
  const ids = [];
  for (let pageNumber = 1; pageNumber <= 7; pageNumber += 1) {
    await expect(page.locator('tbody .order-id').first()).toHaveText(orders[(pageNumber - 1) * 30].order_id);
    await expect(page.locator('tbody tr')).toHaveCount(pageNumber === 7 ? 25 : 30);
    await expect(page.locator('.pagination')).toContainText(`Page ${pageNumber} of 7`);
    ids.push(...await page.locator('tbody .order-id').allTextContents());
    if (pageNumber < 7) await page.getByRole('button', { name: 'Next page', exact: true }).click();
  }
  expect(ids).toEqual(orders.map((order) => order.order_id));
  expect(new Set(ids).size).toBe(205);
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(page.locator('tbody .order-id').first()).toHaveText(orders[150].order_id);
  await page.locator('#category').selectOption('Furniture');
  await expect(page.locator('.pagination')).toContainText('Page 1 of 4');
  await expect(page.locator('tbody .order-id').first()).toHaveText('TEST-0204');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('102');
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search orders' }).fill('TEST-0001');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody .order-id')).toHaveText('TEST-0001');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('1');
});

test('commerce export retrieves all API pages and preserves category filters', async ({ page }) => {
  const requests = await mockOrders(page);
  await page.goto('/');
  await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('205');
  for (const category of ['', 'Furniture']) {
    if (category) {
      await page.locator('#category').selectOption(category);
      await expect(page.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText('102');
    }
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^commerce-orders-.*\.csv$/);
    const lines = (await readFile(await file.path(), 'utf8')).split('\r\n');
    const expected = category ? orders.filter((order) => order.items[0].category === category) : orders;
    expect(lines).toHaveLength(expected.length + 1);
    expect(new Set(lines.slice(1)).size).toBe(expected.length);
    expected.forEach((order, index) => expect(lines[index + 1].startsWith(`"${order.order_id}",`)).toBe(true));
    expect(requests.filter((request) => request.pageSize === 100 && request.category === (category || null)).map((request) => request.page))
      .toEqual(category ? [1, 2] : [1, 2, 3]);
  }
});
