import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";

import { waitForHydration } from "../tests/support/e2e-hydration";

// P4b, PR B: the explorer's side of reports of a problem with a place. The explorer sends a report
// from the place page, sees it in "Moje zgłoszenia" as waiting, the curator accepts it, and the
// explorer then reads "Przyjęte — dziękujemy"; another explorer does not see it; a guest is sent
// to sign in; a member of the organization of the place is told to use the editor. The form says
// BEFORE sending what the curator sees. Needs a migrated, seeded database like the other specs that
// sign in, and the server started with FEATURE_PLACE_REPORTS=true (playwright.config.ts and
// scripts/test-env set it); without a database the spec is skipped.
//
// The switch off (404 of the route, the form and "Moje zgłoszenia", no links) is tested with the
// handler and the pages (tests/features/reports/http, tests/app/place-reports-pages.test.ts) and on
// the database (tests/integration/place-reports-limits.test.ts): one server runs with one value.
//
// It is independent of e2e/place-reports-curator.spec.ts: the report it adds to the queue is
// decided (accepted) in the test itself, so the queue that spec counts is left as it was.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const CATEGORY = "Zła lokalizacja na mapie";
const NOTICE =
  "Kurator zobaczy Twoje imię i pierwszą literę nazwiska (np. Anna K.), bez adresu e-mail.";

const emailOf = (name: string) => `${name}@demo.krajozbior.local`;

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

async function signedInPage(
  browser: Browser,
  name: string,
  viewport = { width: 390, height: 800 },
  colorScheme: "light" | "dark" = "light",
): Promise<Page> {
  const context = await browser.newContext({ viewport, colorScheme });
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(emailOf(name));
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).not.toHaveURL(/\/login/);

  return page;
}

// The page of the bridge, reached the way a visitor reaches it: through the collection.
async function openBridge(page: Page): Promise<string> {
  await page.goto(`/collections/${DEMO_SLUG}`);
  await page.goto(
    (await page.getByRole("link", { name: /Most Tczewski/ }).getAttribute("href")) ?? "",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Most Tczewski" })).toBeVisible();
  await waitForHydration(page);

  return new URL(page.url()).pathname;
}

test.describe("reports of a problem with a place: the explorer", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("sends a report, sees it waiting and then accepted; another explorer and a guest do not", async ({
    browser,
  }) => {
    const explorer = await signedInPage(browser, "user");
    const placePath = await openBridge(explorer);

    // from the place page to the form
    await explorer.getByRole("link", { name: "Zgłoś problem z miejscem" }).click();
    await expect(explorer).toHaveURL(new RegExp(`${placePath}/report$`));
    await waitForHydration(explorer);
    await expect(
      explorer.getByRole("heading", {
        level: 1,
        name: "Co jest nie tak z miejscem Most Tczewski?",
      }),
    ).toBeVisible();

    // the sentence about what the curator sees stands above the send button, before sending
    const notice = explorer.getByText(NOTICE);
    const send = explorer.getByRole("button", { name: "Wyślij zgłoszenie" });

    await expect(notice).toBeVisible();
    await expect(send).toBeEnabled();

    const noticeBox = (await notice.boundingBox())!;
    const sendBox = (await send.boundingBox())!;

    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(sendBox.y);
    // the form fits a phone: nothing sticks out sideways
    expect(
      await explorer.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expectNoAccessibilityViolations(explorer);

    // no kind chosen: the form says so and keeps the focus on the first choice
    await send.click();
    await expect(explorer.getByText("Wybierz rodzaj problemu.")).toBeVisible();
    await expect(explorer.getByRole("radio").first()).toBeFocused();

    // a kind that needs words, without words
    await explorer.getByRole("radio", { name: "Inne" }).check();
    await send.click();
    await expect(
      explorer.getByText("Opisz problem — przy tym rodzaju kurator potrzebuje kilku słów."),
    ).toBeVisible();

    // the real report
    await explorer.getByRole("radio", { name: CATEGORY }).check();
    await explorer
      .getByLabel("Co jest na miejscu inaczej?")
      .fill("Pinezka stoi po drugiej stronie rzeki.");
    await send.click();

    // inside <main>: the route announcer of Next.js is a role "alert" outside of it
    const thanks = explorer
      .locator("main")
      .getByRole("status")
      .filter({ hasText: "Dziękujemy. Zgłoszenie trafiło do:" });

    await expect(thanks).toBeVisible();
    await expect(thanks).toContainText("Decyzję zobaczysz w „Moich zgłoszeniach”.");
    await expect(thanks).toBeFocused();

    // the same kind for the same place again: refused with a sentence, not a failure
    await explorer.goto(`${placePath}/report`);
    await waitForHydration(explorer);
    await explorer.getByRole("radio", { name: CATEGORY }).check();
    await explorer.getByRole("button", { name: "Wyślij zgłoszenie" }).click();

    const refusal = explorer.locator("main").getByRole("alert");

    await expect(refusal).toContainText("Twoje zgłoszenie tego rodzaju już czeka na kuratora.");
    await expect(refusal).toBeFocused();

    // "Moje zgłoszenia" from the profile: the report waits
    await explorer.goto("/my");
    await explorer.getByRole("link", { name: "Moje zgłoszenia" }).click();
    await expect(explorer).toHaveURL(/\/my\/reports$/);
    await expect(
      explorer.getByRole("heading", { level: 1, name: "Moje zgłoszenia" }),
    ).toBeVisible();

    const mine = explorer.getByRole("article").filter({ hasText: CATEGORY });

    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText("Most Tczewski");
    await expect(mine).toContainText("Czeka na kuratora");
    await expect(mine).toContainText("Zgłoszenie do:");
    await expectNoAccessibilityViolations(explorer);

    // the curator of the organization accepts it
    const curator = await signedInPage(browser, "curator-a", { width: 1440, height: 900 });

    await curator.goto("/curator/reports");
    await waitForHydration(curator);

    const queued = curator.getByRole("article").filter({ hasText: CATEGORY });

    await expect(queued).toContainText("Pinezka stoi po drugiej stronie rzeki.");
    await queued.getByRole("button", { name: "Przyjmij" }).click();
    await expect(curator.locator("main").getByRole("status")).toContainText("Przyjęto zgłoszenie");
    await curator.context().close();

    // the explorer reads the decision, and no name of a curator
    await explorer.reload();
    await expect(mine).toContainText("Przyjęte — dziękujemy");
    await expect(mine).not.toContainText("Czeka na kuratora");

    // another explorer sees none of it
    const other = await signedInPage(browser, "user2");

    await other.goto("/my/reports");
    await expect(other.getByRole("heading", { level: 1, name: "Moje zgłoszenia" })).toBeVisible();
    await expect(other.getByText(CATEGORY)).toHaveCount(0);
    await expect(other.getByRole("article")).toHaveCount(0);
    await expect(other.getByText("Nie masz jeszcze zgłoszeń.")).toBeVisible();
    await other.context().close();

    // a guest is sent to sign in and back to the form
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();

    await guestPage.goto(placePath);
    await guestPage.getByRole("link", { name: "Zgłoś problem z miejscem" }).click();
    await expect(guestPage).toHaveURL(/\/login\?returnTo=/);
    expect(decodeURIComponent(new URL(guestPage.url()).searchParams.get("returnTo") ?? "")).toBe(
      `${placePath}/report`,
    );
    await guestPage.goto("/my/reports");
    await expect(guestPage).toHaveURL(/\/login\?returnTo=%2Fmy%2Freports$/);
    await guest.close();
    await explorer.context().close();
  });

  test("a member of the organization of the place is told to use the editor, and the route refuses them", async ({
    browser,
  }) => {
    const curator = await signedInPage(browser, "curator-a", { width: 1440, height: 900 });
    const placePath = await openBridge(curator);

    await curator.goto(`${placePath}/report`);
    await expect(curator.getByText("Prowadzisz to miejsce — popraw je w edytorze.")).toBeVisible();
    await expect(curator.getByRole("button", { name: "Wyślij zgłoszenie" })).toHaveCount(0);
    await expect(curator.getByRole("link", { name: "Otwórz edytor" })).toHaveAttribute(
      "href",
      /\/curator\/collections\/[0-9a-f-]+\/places\/[0-9a-f-]+$/,
    );
    await expectNoAccessibilityViolations(curator);

    const placeId = placePath.replace("/places/", "");
    const response = await curator.request.post(`/api/places/${placeId}/reports`, {
      data: { category: "closed", message: "" },
    });

    expect(response.status()).toBe(403);
    await curator.context().close();
  });

  test("the form works in the dark theme on a computer", async ({ browser }) => {
    const explorer = await signedInPage(browser, "user2", { width: 1440, height: 900 }, "dark");
    const placePath = await openBridge(explorer);

    await explorer.goto(`${placePath}/report`);
    await expect(explorer.getByText(NOTICE)).toBeVisible();
    await expectNoAccessibilityViolations(explorer);
    await explorer.context().close();
  });

  test("the route answers 401 to a guest and 404 to a place that does not exist", async ({
    browser,
    request,
  }) => {
    const explorer = await signedInPage(browser, "user2");
    const missing = "00000000-0000-4000-8000-000000000000";
    const guestAnswer = await request.post(`/api/places/${missing}/reports`, {
      data: { category: "closed", message: "" },
    });

    expect(guestAnswer.status()).toBe(401);

    const answer = await explorer.request.post(`/api/places/${missing}/reports`, {
      data: { category: "closed", message: "" },
    });

    expect(answer.status()).toBe(404);
    await explorer.context().close();
  });
});
