import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";

import { waitForHydration } from "../tests/support/e2e-hydration";

// P4b, PR A: the queue of reports in the panel of the curator, on the three demo reports of the
// seed (two waiting, one rejected, all about places of the organization of curator-a). Needs a
// migrated, seeded database like the other curator specs; without it the spec is skipped. The
// spec changes the queue (decides, undoes), so it runs on a fresh environment.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const emailOf = (name: string) => `${name}@demo.krajozbior.local`;
const desktop = { width: 1440, height: 900 };

async function signedInPage(
  browser: Browser,
  name: string,
  colorScheme: "light" | "dark" = "light",
): Promise<Page> {
  const context = await browser.newContext({ viewport: desktop, colorScheme });
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(emailOf(name));
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/curator$/);

  return page;
}

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

test.describe("queue of reports of the curator", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("the panel counts the waiting reports and leads to the list; the curator decides, undoes and accepts", async ({
    browser,
  }) => {
    const curator = await signedInPage(browser, "curator-a");
    const attention = curator.getByRole("region", { name: "Wymaga uwagi" });

    await expect(
      attention.getByRole("link", { name: "Zgłoszenia do sprawdzenia: 2" }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(curator);

    await attention.getByRole("link", { name: "Zgłoszenia do sprawdzenia: 2" }).click();
    await expect(curator).toHaveURL(/\/curator\/reports\?organization=/);
    await expect(
      curator.getByRole("heading", { level: 1, name: "Zgłoszenia od odkrywców" }),
    ).toBeVisible();
    await expect(
      curator.getByRole("navigation", { name: "Panel kuratora" }).getByRole("link", {
        name: "Zgłoszenia",
      }),
    ).toHaveAttribute("aria-current", "page");
    await expect(curator.getByRole("link", { name: "Do sprawdzenia (2)" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const reports = curator.getByRole("article");

    await expect(reports).toHaveCount(2);
    // The oldest first; the author is a label, never an address.
    await expect(reports.first()).toContainText("Most Tczewski");
    await expect(reports.first()).toContainText("Zgłoszenie od: Odkrywca");
    await expect(reports.first()).toContainText("Niedostępne lub zamknięte");
    await expect(reports.first()).toContainText("Brama przy wejściu była zamknięta");
    await expect(curator.locator("main")).not.toContainText("@");
    await expectNoAccessibilityViolations(curator);

    // Reject with a reason: the report leaves the list, the focus goes to the next one.
    await waitForHydration(curator);
    await reports.first().getByRole("button", { name: "Odrzuć" }).click();

    const dialog = curator.getByRole("dialog");

    await expect(dialog).toBeVisible();
    await expectNoAccessibilityViolations(curator);
    // No reason, no rejection: the dialog says so and keeps the focus on the field.
    await dialog.getByRole("button", { name: "Odrzuć zgłoszenie" }).click();
    await expect(dialog.getByText("Wybierz powód odrzucenia.")).toBeVisible();
    await dialog.getByLabel("Powód").selectOption({ label: "Zgłoszenie się powtarza" });
    await dialog.getByLabel(/Notatka/).fill("To samo zgłosił ktoś wcześniej.");
    await dialog.getByRole("button", { name: "Odrzuć zgłoszenie" }).click();

    await expect(dialog).toBeHidden();
    await expect(curator.locator("main").getByRole("status")).toContainText(
      "Odrzucono zgłoszenie: Most Tczewski.",
    );
    await expect(reports).toHaveCount(1);
    await expect(reports.first().getByRole("heading", { level: 2 })).toBeFocused();
    await expect(curator.getByRole("link", { name: "Do sprawdzenia (1)" })).toBeVisible();

    // Undo from the message under the list.
    await curator.getByRole("button", { name: "Cofnij", exact: true }).click();
    await expect(curator.locator("main").getByRole("status")).toContainText(
      "Cofnięto decyzję: Most Tczewski.",
    );
    await expect(reports).toHaveCount(2);
    await expect(curator.getByRole("link", { name: "Do sprawdzenia (2)" })).toBeVisible();

    // Accept the first one: the "Edit the place" link leads to the editor.
    await expect(reports.first().getByRole("link", { name: "Edytuj miejsce" })).toHaveAttribute(
      "href",
      /\/curator\/collections\/[0-9a-f-]+\/places\/[0-9a-f-]+$/,
    );
    await reports.first().getByRole("button", { name: "Przyjmij" }).click();
    await expect(curator.locator("main").getByRole("status")).toContainText("Przyjęto zgłoszenie:");
    await expect(reports).toHaveCount(1);
    await expect(curator.getByRole("link", { name: "Do sprawdzenia (1)" })).toBeVisible();

    // "Rozpatrzone": the seeded rejection and the new acceptance, each with "Cofnij decyzję".
    await curator.getByRole("link", { name: "Rozpatrzone" }).click();
    await expect(curator.getByRole("link", { name: "Rozpatrzone" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(reports).toHaveCount(2);
    await expect(curator.getByRole("article", { name: /Zamek w Malborku/ })).toContainText(
      "Powód: Nie zgadza się ze stanem na miejscu.",
    );
    await expect(curator.getByRole("article", { name: /Zamek w Malborku/ })).toContainText(
      "Notatka: Sprawdziliśmy na miejscu: ścieżka jest ogólnodostępna.",
    );
    await expect(curator.getByRole("button", { name: "Cofnij decyzję" })).toHaveCount(2);
    await expectNoAccessibilityViolations(curator);
    await curator.context().close();
  });

  test("the list and the counter work in the dark theme too", async ({ browser }) => {
    const curator = await signedInPage(browser, "curator-a", "dark");

    await expect(curator.getByRole("region", { name: "Wymaga uwagi" })).toBeVisible();
    await expectNoAccessibilityViolations(curator);
    await curator.goto("/curator/reports");
    await expect(
      curator.getByRole("heading", { level: 1, name: "Zgłoszenia od odkrywców" }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(curator);
    await curator.context().close();
  });

  test("a curator of another organization sees nothing of it and gets 404 on the decision route", async ({
    browser,
  }) => {
    const curatorA = await signedInPage(browser, "curator-a");

    await curatorA.goto("/curator/reports");

    const labelled = await curatorA.getByRole("article").first().getAttribute("aria-labelledby");
    const reportId = labelled?.replace(/^report-/, "") ?? "";

    expect(reportId).toMatch(/^[0-9a-f-]{36}$/);
    await curatorA.context().close();

    const curatorB = await signedInPage(browser, "curator-b");

    await expect(curatorB.getByText("Zgłoszenia: nic nie czeka")).toBeVisible();
    await curatorB.goto("/curator/reports");
    await expect(curatorB.getByRole("article")).toHaveCount(0);
    await expect(
      curatorB.getByText(
        "Nic nie czeka na decyzję. Gdy odkrywca zgłosi problem z miejscem Twojej organizacji",
      ),
    ).toBeVisible();
    await expectNoAccessibilityViolations(curatorB);

    const response = await curatorB.request.post(`/api/curator/reports/${reportId}/decision`, {
      data: { action: "accept", version: 1 },
    });

    expect(response.status()).toBe(404);
    await curatorB.context().close();
  });

  test("a failed rejection says so inside the open dialog and moves the focus there", async ({
    browser,
  }) => {
    const curator = await signedInPage(browser, "curator-a");

    await curator.goto("/curator/reports");
    await waitForHydration(curator);
    // The answer is stubbed, so nothing changes in the seeded queue.
    await curator.route("**/api/curator/reports/*/decision", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await curator.getByRole("article").first().getByRole("button", { name: "Odrzuć" }).click();

    const dialog = curator.getByRole("dialog");

    await dialog.getByLabel("Powód").selectOption({ label: "Zgłoszenie się powtarza" });
    await dialog.getByRole("button", { name: "Odrzuć zgłoszenie" }).click();

    const alert = dialog.getByRole("alert");

    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Nie udało się zapisać decyzji");
    await expect(alert).toBeFocused();
    await expect(dialog).toBeVisible();
    await expectNoAccessibilityViolations(curator);
    await curator.context().close();
  });

  test("a guest and an explorer have no way in; the phone shows the notice", async ({
    page,
    browser,
  }) => {
    await page.goto("/curator/reports");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcurator%2Freports$/);

    const response = await page.request.post(
      "/api/curator/reports/00000000-0000-4000-8000-000000000000/decision",
      { data: { action: "accept", version: 1 } },
    );

    expect(response.status()).toBe(401);

    const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const phonePage = await phone.newPage();

    await phonePage.goto("/login");
    await phonePage.getByText("Logowanie hasłem").click();

    const form = phonePage.locator("form", { has: phonePage.getByLabel("Hasło") });

    await form.getByLabel("E-mail").fill(emailOf("curator-a"));
    await form.getByLabel("Hasło").fill(password ?? "");
    await form.getByRole("button", { name: "Zaloguj się" }).click();
    await expect(phonePage).toHaveURL(/\/curator$/);
    await phonePage.goto("/curator/reports");
    await expect(phonePage.getByRole("note")).toContainText(
      "Panel kuratora jest przeznaczony na komputer",
    );
    await phone.close();
  });
});
