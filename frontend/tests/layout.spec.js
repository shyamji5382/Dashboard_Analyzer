import { expect, test } from '@playwright/test';

test('reference-inspired cards and chart tools fit narrow and tablet widths', async ({ page }, testInfo) => {
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ['countries', 'overview']) {
      await page.goto(view === 'countries' ? '/' : '/?view=overview');
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
