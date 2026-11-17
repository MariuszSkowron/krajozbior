import { expect, test } from "@playwright/test";

// Start page of a guest. It needs no database.
test("a guest sees the start page and the login link", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Witaj w aplikacji" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Zaloguj się" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("a successful sign-out is confirmed in a status region", async ({ page }) => {
  await page.goto("/?wylogowano=1");

  await expect(page.getByRole("status").filter({ hasText: "Wylogowano." })).toBeVisible();
});

test("the guest does not get a sign-out button after a failed sign-out", async ({ page }) => {
  await page.goto("/?wylogowanie=blad");

  await expect(
    page.getByRole("status").filter({ hasText: "Nie udało się wylogować. Spróbuj ponownie." }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Wyloguj" })).toHaveCount(0);
});

test("the start page keeps its content inside the screen on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
