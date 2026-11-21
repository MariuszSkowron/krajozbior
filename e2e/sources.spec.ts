import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

// Podpisy źródeł (PR-B kolekcji): gość otwiera stronę „Źródła danych” ze stopki, bez logowania,
// widzi licencje z odnośnikami, a strona nie ma naruszeń dostępności (axe) w obu motywach.
// Linia źródeł pod opisem miejsca jest sprawdzona w teście renderowania strony miejsca i w teście
// integracyjnym odczytu; konta i miejsca demo nie mają wiersza w źródłach.
async function expectNoAccessibilityViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  await page.addScriptTag({ content: axe.source });

  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run();

    return result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    }));
  });

  expect(violations).toEqual([]);
}

for (const viewport of [
  { name: "telefon", width: 390, height: 844 },
  { name: "komputer", width: 1280, height: 800 },
]) {
  test(`gość otwiera „Źródła danych” ze stopki na ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "Źródła danych" }).click();

    await expect(page).toHaveURL(/\/zrodla$/);
    await expect(page.getByRole("heading", { level: 1, name: "Źródła danych" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by/4.0/",
    );
    await expect(page.getByText("Wydawcy danych nie odpowiadają za aplikację")).toBeVisible();
    await context.close();
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`strona „Źródła danych” nie ma naruszeń dostępności (motyw ${theme})`, async ({
    browser,
  }) => {
    const context = await browser.newContext();

    await context.addCookies([{ name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" }]);

    const page = await context.newPage();

    await page.goto("/zrodla");
    await expect(page.getByRole("heading", { level: 1, name: "Źródła danych" })).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await context.close();
  });
}
