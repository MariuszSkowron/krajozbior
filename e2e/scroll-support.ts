import { expect, type Locator, type Page } from "@playwright/test";

// A click on a filter must not scroll the page to the top. A shorter list lets the browser clamp
// scrollY to the new maximum (or to 0 when the page becomes lower than the window), so the check
// is: the page did not jump to the top, and scrollY equals the old value or the largest value the
// page still allows. `nav` is the filter that has to stay in view.
export async function expectScrollKept(page: Page, nav: Locator, previous: number) {
  const { y, max } = await page.evaluate(() => ({
    y: window.scrollY,
    max: document.documentElement.scrollHeight - window.innerHeight,
  }));

  expect(max).toBeGreaterThan(0);
  expect(y).toBeGreaterThan(0);
  expect(y).toBeLessThanOrEqual(previous + 2);
  // A small margin for the sticky header and layout settling after the shorter list renders.
  expect(y).toBeGreaterThanOrEqual(Math.min(previous, max) - 24);
  await expect(nav).toBeInViewport();
}
