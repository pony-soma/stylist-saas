import { expect, type Page } from '@playwright/test';

export async function expectDateInputsContained(page: Page) {
  const original = page.viewportSize();
  for (const width of [320, 375, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const input of await page.locator('input[type="date"], input[type="time"]').all()) {
      if (!await input.isVisible()) continue;
      await expect(input).toHaveCSS('min-width', '0px');
      const bounds = await input.evaluate(el => {
        const r = el.getBoundingClientRect();
        const p = el.parentElement!.getBoundingClientRect();
        return r.width > 0 && r.left >= p.left - 1 && r.right <= p.right + 1 && r.right <= innerWidth + 1;
      });
      expect(bounds, `date/time input must fit parent and viewport at ${width}px`).toBe(true);
    }
  }
  if (original) await page.setViewportSize(original);
}
