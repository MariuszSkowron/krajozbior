import { expect, type Locator, type Page } from "@playwright/test";

// The sections of a page enter with a short animation (12 px shift, up to about 1 s with the
// delays; theme.css, `section-enter`). Until it ends, the sticky filter bar is drawn up to 12 px
// lower and is "not stable" for a click, so Playwright scrolls it into view itself and moves the
// page. A fast machine (CI) measures inside the animation, a slower one after it; measure scroll
// and position only after every animation of the page has finished.
export async function waitForEntrance(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null))),
  );
}

// A precaution (the cause of the rare failure is not confirmed): waits for the images that are
// already loading, so a late image cannot move the page during the measurement. Lazy images that
// have not started loading are skipped (decode() could wait for them forever), and the wait has a
// limit of 3 s.
export async function waitForImages(page: Page) {
  await page.evaluate(() => {
    const loading = Array.from(document.images).filter(
      (image) => !(image.loading === "lazy" && !image.complete && image.currentSrc === ""),
    );
    const settled = Promise.all(loading.map((image) => image.decode().catch(() => undefined)));

    return Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 3000))]);
  });
}

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
