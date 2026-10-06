import { expect, test } from '@playwright/test';

test('short-height navigation keeps Countries and commerce reachable', async ({ page }, testInfo) => {
  for (const viewport of [{ width: 600, height: 350 }, { width: 1024, height: 350 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.kpi-value').first()).toHaveText('$2,800.00');
    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (await menu.isVisible()) await menu.click();
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    const countries = navigation.getByRole('button', { name: 'Countries', exact: true });
    await countries.scrollIntoViewIfNeeded();
    await expect(countries).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath(`navigation-${viewport.width}x${viewport.height}.png`) });
    await countries.click();
    await expect(page.getByRole('heading', { name: 'Countries Analytics', exact: true })).toBeVisible();
    await expect(page.locator('.kpi-value').first()).toHaveText('250');
    if (await menu.isVisible()) await menu.click();
    await navigation.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Commerce Analytics Dashboard', exact: true })).toBeVisible();
    await expect(page.locator('.kpi-value').first()).toHaveText('$2,800.00');
  }
});

test('reference-inspired cards and chart tools fit narrow and tablet widths', async ({ page }, testInfo) => {
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ['overview', 'countries']) {
      await page.goto(view === 'countries' ? '/?view=countries' : '/');
      await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText(view === 'countries' ? '250' : '$2,800.00');
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.kpi')];
        return {
          fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth && innerWidth <= screen.width,
          colors: cards.map((card) => getComputedStyle(card).backgroundColor),
          contentFits: cards.every((card) => {
            const outer = card.getBoundingClientRect();
            const parts = [...card.children].map((child) => child.getBoundingClientRect());
            return parts.every((part, index) => part.left >= outer.left && part.right <= outer.right + 1 && part.bottom <= outer.bottom && (!index || part.top >= parts[index - 1].bottom - 1));
          }),
          chartsFit: [...document.querySelectorAll('.chart-panel, .country-chart-panel')].every((panel) => panel.scrollWidth <= panel.clientWidth),
        };
      });
      expect(layout.fits).toBe(true);
      expect(new Set(layout.colors).size).toBe(4);
      expect(layout.contentFits).toBe(true);
      expect(layout.chartsFit).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${view}-${width}.png`), fullPage: true });
    }
  }
});
