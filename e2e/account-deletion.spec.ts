import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// E9-5: deleting one's own account from the screen "Ustawienia". The spec uses
// throwaway accounts made by the sign-in code (never the demo accounts: deleting
// one would break the other specs). The code is read from the local e-mail outbox
// of the test server (`.data/e2e-email-outbox`, like playwright.config.ts). The
// audit entry is read through DATABASE_ADMIN_URL, which parseE2eAdminDatabaseUrl
// accepts only for the disposable E2E database. Without the demo password (a
// migrated, seeded database) the spec is skipped, like the other specs that sign in.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const OUTBOX = path.resolve(process.cwd(), ".data", "e2e-email-outbox");
const SCREEN = "/my/delete-account";

// Each address may ask for three codes in 15 minutes: every test makes its own.
const newAddress = (label: string) =>
  `e95-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

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

async function adminQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

const outboxFiles = async () =>
  (await readdir(OUTBOX).catch(() => [] as string[])).filter((name) => name.endsWith(".eml"));

// The six digits of the newest message to `email` that was not there before `known`.
async function codeFor(email: string, known: ReadonlySet<string>): Promise<string> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    for (const file of (await outboxFiles())
      .filter((name) => !known.has(name))
      .sort()
      .reverse()) {
      const raw = await readFile(path.join(OUTBOX, file), "utf8");

      if (!raw.includes(`To: ${email}`)) {
        continue;
      }

      for (const [, body] of raw.matchAll(
        /Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+?)(?=\r?\n--)/g,
      )) {
        const text = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
        const code = /\b(\d{6})\b/.exec(text)?.[1];

        if (code !== undefined) {
          return code;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("The sign-in code did not arrive in the outbox");
}

// Asks for a code on /login (optionally coming back to `returnTo`), reads it from
// the outbox and signs in; the first sign-in with an address creates the account.
async function signInWithCode(page: Page, email: string, from = "/login") {
  const known = new Set(await outboxFiles());

  await page.goto(from);
  await page.locator("#code-request-email").fill(email);
  await page.getByRole("button", { name: "Wyślij kod" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("kod jest już w drodze");

  await page.locator("#code-verify-code").fill(await codeFor(email, known));
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await acceptTermsWhenAsked(page);
}

// A new account first sees „Zanim zaczniesz” (F-K3); this spec tests the deletion, so it
// accepts the terms and goes on. The screen itself is tested by terms-acceptance.spec.ts.
async function acceptTermsWhenAsked(page: Page) {
  await page.waitForLoadState();

  const gate = page.getByRole("heading", { level: 1, name: "Zanim zaczniesz" });

  if (await gate.isVisible()) {
    await page.getByLabel(/Akceptuję Regulamin/).check();
    await page.getByRole("button", { name: "Akceptuję", exact: true }).click();
    await expect(gate).toBeHidden();
  }
}

async function newSignedInPage(browser: Browser, email: string, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await context.newPage();

  await signInWithCode(page, email);

  return { context, page };
}

const accountId = async (email: string) =>
  (await adminQuery<{ id: string }>(`select id from auth.users where email = $1`, [email]))[0]?.id;

async function confirmDeletion(page: Page, word: string) {
  await page.getByLabel(/Wpisz USUŃ/).fill(word);
  await page.getByRole("button", { name: "Usuń konto na stałe" }).click();
}

test.describe("deleting the account", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("a guest cannot delete anything", async ({ request }) => {
    const response = await request.post("/api/me/account/deletion", {
      data: { confirmation: "USUŃ" },
    });

    expect(response.status()).toBe(401);
  });

  test("from Profile to Settings to the deletion screen, a wrong word first, then the account is gone and the audit says so", async ({
    browser,
  }) => {
    const email = newAddress("flow");
    const { context, page } = await newSignedInPage(browser, email);

    // The way a person finds it: Profile -> Ustawienia -> Usuń konto.
    await page.goto("/my");
    await page.getByRole("main").getByRole("link", { name: "Ustawienia" }).click();
    await expect(page).toHaveURL(/\/my\/settings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ustawienia" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link")).toHaveText(["Usuń konto"]);
    await expectNoAccessibilityViolations(page);
    await page.getByRole("link", { name: "Usuń konto" }).click();
    await expect(page).toHaveURL(new RegExp(`${SCREEN}$`));

    // Both themes pass the automatic accessibility check.
    await expect(page.getByRole("heading", { level: 1, name: "Usuń konto" })).toBeVisible();
    await expect(page.getByText("Tego nie da się cofnąć.")).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await page
      .context()
      .addCookies([{ name: "krajozbior-theme", value: "light", url: "http://127.0.0.1" }]);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/theme-light/);
    await expectNoAccessibilityViolations(page);

    const id = await accountId(email);

    expect(id).toBeDefined();

    // A wrong word does nothing and says why.
    await confirmDeletion(page, "tak");
    await expect(page).toHaveURL(/blad=invalid_confirmation/);
    // Filtered by text: Next.js adds its own role="alert" route announcer to every page.
    await expect(
      page.getByRole("alert").filter({ hasText: "Wpisz dokładnie słowo USUŃ" }),
    ).toBeVisible();
    expect(await accountId(email)).toBe(id);

    // The same account in a second browser, to see its session stop.
    const second = await newSignedInPage(browser, email);

    expect((await second.page.request.get("/api/me")).status()).toBe(200);

    await confirmDeletion(page, "USUŃ");
    await expect(page).toHaveURL(/\/\?konto=usuniete$/);
    // Filtered by text: the "W okolicy" section has its own, usually empty, role="status".
    await expect(
      page
        .getByRole("main")
        .getByRole("status")
        .filter({ hasText: "Twoje konto zostało usunięte." }),
    ).toBeVisible();
    expect((await page.request.get("/api/me")).status()).toBe(401);

    // The session of the second browser stops at its next request.
    expect((await second.page.request.get("/api/me")).status()).toBe(401);
    await second.page.goto("/my");
    await expect(second.page).toHaveURL(`/login?returnTo=${encodeURIComponent("/my")}`);
    await second.context.close();

    expect(await accountId(email)).toBeUndefined();
    const entries = await adminQuery<Record<string, unknown>>(
      `select operation, outcome, operator_label, recorded_by from public.operations_audit
        where subject_user_id = $1`,
      [id],
    );

    expect(entries).toEqual([
      {
        operation: "delete_account",
        outcome: "applied",
        operator_label: "self-service",
        recorded_by: "krajozbior_auth",
      },
    ]);

    // Q15: the same address makes a new, empty account with another id.
    const again = await newSignedInPage(browser, email);
    const newId = await accountId(email);

    expect(newId).toBeDefined();
    expect(newId).not.toBe(id);
    await again.page.goto("/my");
    await expect(again.page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
    expect(
      await adminQuery(`select 1 from public.visits where user_id = $1`, [newId]),
    ).toHaveLength(0);

    // Leaves no account behind (the audit entry stays, by design).
    await adminQuery(`delete from auth.users where id = $1`, [newId]);
    await again.context.close();
    await context.close();
  });

  test("an old sign-in asks to sign in again and comes back to the deletion screen", async ({
    browser,
  }) => {
    const email = newAddress("stale");
    const { context, page } = await newSignedInPage(browser, email);

    await adminQuery(
      `update auth.sessions set created_at = now() - interval '16 minutes'
        where user_id = (select id from auth.users where email = $1)`,
      [email],
    );
    await page.goto(SCREEN);
    await expect(
      page.getByRole("heading", { level: 2, name: "Zaloguj się ponownie" }),
    ).toBeVisible();
    await expect(page.getByLabel(/Wpisz USUŃ/)).toHaveCount(0);

    // The button ends the session and leads to the login, which returns here.
    await page.getByRole("button", { name: "Zaloguj się ponownie" }).click();
    await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(SCREEN)}`);
    await signInWithCode(page, email, `/login?returnTo=${encodeURIComponent(SCREEN)}`);
    await expect(page).toHaveURL(new RegExp(`${SCREEN}$`));
    await expect(page.getByLabel(/Wpisz USUŃ/)).toBeVisible();

    await confirmDeletion(page, "usuń");
    await expect(page).toHaveURL(/\/\?konto=usuniete$/);
    expect(await accountId(email)).toBeUndefined();

    await context.close();
  });

  test("the administrator is told that the team deletes that account", async ({ browser }) => {
    const context: BrowserContext = await browser.newContext({
      viewport: { width: 390, height: 800 },
    });
    const page = await context.newPage();

    await page.goto("/login");

    await page.getByText("Logowanie hasłem").click();

    const form = page.locator("form", { has: page.getByLabel("Hasło") });

    await form.getByLabel("E-mail").fill("admin@demo.krajozbior.local");
    await form.getByLabel("Hasło").fill(password ?? "");
    await form.getByRole("button", { name: "Zaloguj się" }).click();
    await expect(page).toHaveURL(/\/my$/);

    await page.goto(SCREEN);
    await expect(page.getByText("Konto administratora usuwa zespół")).toBeVisible();
    await expect(page.getByLabel(/Wpisz USUŃ/)).toHaveCount(0);

    // Whatever the screen shows, the route refuses (409), and the account stays.
    const response = await page.request.post("/api/me/account/deletion", {
      data: { confirmation: "USUŃ" },
    });

    expect(response.status()).toBe(409);
    expect(await response.json()).toEqual({ error: "managed_account" });

    await context.close();
  });
});
