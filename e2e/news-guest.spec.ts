import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// E7-R3: publiczne strony aktualności redakcji (`/news`, `/news/[slug]`), odnośnik gościa
// w nagłówku i piąta pozycja dolnego paska. Potrzebuje zmigrowanej i zasianej bazy (organizacja
// redakcji i aktualności demo z `seed:demo`), jak inne specyfikacje; bez niej jest pomijana.
// Własne wiersze testu (przyszłe i minione wydarzenie, wycofana, treść z kodem) wstawia i usuwa
// połączenie administratora, jak `public-catalog.spec.ts`; szkic demo zasiewa `seed:demo`.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const PHONE = { width: 390, height: 844 };
const NAV = 'nav[aria-label="Główna"]';

const GUIDE_SLUG = "jak-zbierac-miejsca-w-kolekcjach";
const GUIDE_TITLE = "Jak zbierać miejsca w kolekcjach";
const DRAFT_SLUG = "szkic-aktualnosci-demo";

const FUTURE = { slug: "e2e-wydarzenie-przyszle", title: "E2E Wydarzenie przyszłe" };
const PAST = { slug: "e2e-wydarzenie-minione", title: "E2E Wydarzenie minione" };
const WITHDRAWN = { slug: "e2e-aktualnosc-wycofana", title: "E2E Aktualność wycofana" };
const MARKUP = { slug: "e2e-aktualnosc-ze-znacznikami", title: "E2E Aktualność ze znacznikami" };
const SLUGS = [FUTURE.slug, PAST.slug, WITHDRAWN.slug, MARKUP.slug];

const MARKUP_BODY = [
  '<script>window.__newsXss = 1</script> i <img src=x onerror="window.__newsXss = 2">',
  "Zły adres javascript:alert(1) oraz http://example.com bez linku.",
  "Dobry adres: https://example.org/strona.",
].join("\n\n");

async function withAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function removeOwnRows(client: Client) {
  await client.query("delete from public.news_posts where slug = any($1::text[])", [SLUGS]);
}

test.describe("aktualności dla gościa", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeAll(async () => {
    await withAdmin(async (client) => {
      await removeOwnRows(client);

      const org = (
        await client.query<{ id: string }>(
          "select id from public.organizations where slug = 'krajozbior-redakcja'",
        )
      ).rows[0];

      if (org === undefined) {
        throw new Error("The editorial organization is missing: run seed:demo first");
      }

      const insert = (
        post: { slug: string; title: string },
        kind: string,
        body: string,
        starts: string | null,
        ends: string | null,
      ) =>
        client.query(
          `insert into public.news_posts
             (organization_id, slug, kind, title, lead, body, event_starts_on, event_ends_on, status)
           values ($1, $2, $3, $4, 'Krótki tekst aktualności testowej.', $5, $6, $7, 'published')`,
          [org.id, post.slug, kind, post.title, body, starts, ends],
        );

      await insert(FUTURE, "event", "", "2099-05-01", "2099-05-02");
      await insert(PAST, "event", "", "2020-01-01", null);
      await insert(MARKUP, "guide", MARKUP_BODY, null, null);
      await insert(WITHDRAWN, "guide", "", null, null);
      // Wycofanie wyzwalacz publikacji przepuszcza tylko jako zmianę stanu istniejącego wiersza.
      await client.query("update public.news_posts set status = 'withdrawn' where slug = $1", [
        WITHDRAWN.slug,
      ]);
    });
  });

  test.afterAll(async () => {
    await withAdmin(removeOwnRows);
  });

  test("lista: gość widzi opublikowane aktualności, nie widzi szkicu ani wycofanej", async ({
    page,
  }) => {
    await page.goto("/news");

    await expect(page).toHaveTitle("Aktualności — Krajozbiór");
    await expect(page.getByRole("heading", { level: 1, name: "Aktualności" })).toBeVisible();
    await expect(page.getByText("Wiadomości od zespołu Krajozbioru")).toBeVisible();

    const main = page.getByRole("main");

    await expect(main.getByRole("link", { name: GUIDE_TITLE })).toHaveAttribute(
      "href",
      `/news/${GUIDE_SLUG}`,
    );
    await expect(main.getByRole("link", { name: FUTURE.title })).toBeVisible();
    await expect(main.getByText("Szkic aktualności demo")).toHaveCount(0);
    await expect(main.getByText(WITHDRAWN.title)).toHaveCount(0);
    // Karta ma jeden link (tytuł), organizację i napis zespołu, nie „Zweryfikowana organizacja”.
    const card = main.locator("article", { hasText: GUIDE_TITLE });

    await expect(card.getByRole("link")).toHaveCount(1);
    await expect(card).toContainText("Krajozbiór — redakcja");
    await expect(card).toContainText("Zespół Krajozbioru");
    await expect(card.locator("time")).toHaveCount(1);
    // Bez „Zgłoś treść” i bez „Nowe” w wersji redakcji.
    await expect(main).not.toContainText("Zgłoś treść");
    await expect(main.getByText("Nowe", { exact: true })).toHaveCount(0);
  });

  test("odnośnik w nagłówku gościa prowadzi do listy i jest tam bieżący", async ({ page }) => {
    await page.goto("/");

    const link = page.getByRole("banner").getByRole("link", { name: "Aktualności" });

    await expect(link).toHaveAttribute("href", "/news");
    await expect(link).not.toHaveAttribute("aria-current", "page");
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    await link.click();
    await expect(page).toHaveURL(/\/news$/);
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(page.locator(NAV)).toHaveCount(0);

    await page.getByRole("main").getByRole("link", { name: GUIDE_TITLE }).click();
    await expect(page).toHaveURL(new RegExp(`/news/${GUIDE_SLUG}$`));
    await expect(link).toHaveAttribute("aria-current", "page");
  });

  test("strona aktualności: treść, metadane i link zewnętrzny z rel", async ({ page }) => {
    await page.goto(`/news/${GUIDE_SLUG}`);

    await expect(page).toHaveTitle(`${GUIDE_TITLE} — Krajozbiór`);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", GUIDE_TITLE);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /odhaczać odwiedzone miejsca/,
    );

    const article = page.getByRole("article");

    await expect(article.getByRole("heading", { level: 1, name: GUIDE_TITLE })).toBeVisible();
    await expect(article.locator("time").first()).toHaveAttribute(
      "datetime",
      /^\d{4}-\d{2}-\d{2}$/,
    );

    const link = article.getByRole("link", { name: "https://krajozbior.example/zasady" });

    await expect(link).toHaveAttribute("href", "https://krajozbior.example/zasady");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
    await expect(article.getByRole("link", { name: "Wszystkie aktualności" })).toHaveAttribute(
      "href",
      "/news",
    );
  });

  test("strona aktualności: znaczniki i javascript: w treści są tekstem, bez linku", async ({
    page,
  }) => {
    await page.goto(`/news/${MARKUP.slug}`);

    const article = page.getByRole("article");

    await expect(article.getByText("<script>window.__newsXss = 1</script>")).toBeVisible();
    await expect(article).toContainText("javascript:alert(1)");
    expect(await page.evaluate(() => (window as { __newsXss?: number }).__newsXss)).toBeUndefined();
    await expect(article.locator("img, script")).toHaveCount(0);
    await expect(article.locator('a[href^="javascript:"], a[href^="http:"]')).toHaveCount(0);
    await expect(article.getByRole("link", { name: "https://example.org/strona" })).toHaveCount(1);
    // Jedyny link w treści; poza nim „Wszystkie aktualności”.
    await expect(article.getByRole("link")).toHaveCount(2);
  });

  test("filtr „Wydarzenia” zostawia wydarzenia bieżące i przyszłe", async ({ page }) => {
    await page.goto("/news");
    await page.getByRole("link", { name: "Wydarzenia", exact: true }).click();
    await expect(page).toHaveURL(/\/news\?filtr=wydarzenia$/);

    const main = page.getByRole("main");

    await expect(main.getByRole("link", { name: FUTURE.title })).toBeVisible();
    await expect(main.getByText(PAST.title)).toHaveCount(0);
    await expect(main.getByText(GUIDE_TITLE)).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Wydarzenia", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(main.getByText(/Wydarzenia: \d+|1 wydarzenie/)).toBeVisible();
    await expect(main.locator("article", { hasText: FUTURE.title })).toContainText(
      "1 maja 2099 – 2 maja 2099",
    );

    await main.getByRole("link", { name: "Wszystkie", exact: true }).click();
    await expect(page.getByRole("main").getByRole("link", { name: GUIDE_TITLE })).toBeVisible();
  });

  test("szkic, wycofana, nieznany i zły adres to 404 bez śladu treści", async ({ page }) => {
    for (const slug of [
      DRAFT_SLUG,
      WITHDRAWN.slug,
      "nie-ma-takiej",
      "Zły_adres",
      "x".repeat(200),
    ]) {
      const response = await page.goto(`/news/${slug}`);

      expect(response?.status(), slug).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "Nie znaleziono" })).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Szkic aktualności demo");
      await expect(page.locator("body")).not.toContainText(WITHDRAWN.title);
    }
  });

  for (const theme of ["dark", "light"] as const) {
    test(`axe bez naruszeń na liście i stronie aktualności (motyw ${theme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: PHONE });

      await context.addCookies([
        { name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" },
      ]);

      const page = await context.newPage();

      for (const path of [
        "/news",
        "/news?filtr=wydarzenia",
        `/news/${GUIDE_SLUG}`,
        `/news/${FUTURE.slug}`,
        `/news/${MARKUP.slug}`,
      ]) {
        await page.goto(path);
        await waitForHydration(page);
        await expect(page.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));
        await page.evaluate(() =>
          Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
        );
        await page.addScriptTag({ content: axe.source });

        const violations = await page.evaluate(async () => {
          const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
          });

          return result.violations.map((violation) => ({
            id: violation.id,
            nodes: violation.nodes.map((node) => node.target.join(" ")),
          }));
        });

        expect(violations, path).toEqual([]);
      }

      await context.close();
    });
  }
});

const emailOf = (name: string) => `${name}@demo.krajozbior.local`;

async function signedInPage(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(emailOf("user"));
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);

  return page;
}

test.describe("piąta pozycja dolnego paska", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("pasek ma 5 pozycji po co najmniej 44 × 44 px, Aktualności są piąte i bieżące na /news", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, PHONE);
    const nav = page.locator(NAV);

    await expect(nav.getByRole("link")).toHaveText([
      "Start",
      "Moje kolekcje",
      "Chcę zobaczyć",
      "Profil",
      "Aktualności",
    ]);

    for (const link of await nav.getByRole("link").all()) {
      const box = await link.boundingBox();

      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    // Zalogowany ma pozycję w pasku, nie odnośnik w nagłówku (B4).
    await expect(page.getByRole("banner").getByRole("link", { name: "Aktualności" })).toHaveCount(
      0,
    );

    for (const path of ["/news", `/news/${GUIDE_SLUG}`]) {
      await page.goto(path);

      const current = nav.locator('a[aria-current="page"]');

      await expect(current).toHaveCount(1);
      await expect(current).toHaveText("Aktualności");
    }

    await page.context().close();
  });

  test("na komputerze menu boczne ma 5 pozycji", async ({ browser }) => {
    const page = await signedInPage(browser, { width: 1280, height: 800 });

    await page.goto("/news");
    await expect(page.locator(NAV).getByRole("link")).toHaveCount(5);
    await expect(page.locator(NAV).locator('a[aria-current="page"]')).toHaveText("Aktualności");
    await page.context().close();
  });

  for (const viewport of [
    { width: 360, height: 640 },
    { width: 320, height: 640 },
  ]) {
    test(`przy tekście 200% pięć etykiet mieści się w pasku (${viewport.width} px)`, async ({
      browser,
    }) => {
      const page = await signedInPage(browser, viewport);

      await page.goto("/news");
      await page.addStyleTag({ content: "html { font-size: 200%; }" });
      await waitForHydration(page);

      const result = await page.evaluate((navSelector) => {
        const nav = document.querySelector(navSelector)!;
        const bar = nav.getBoundingClientRect();

        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          links: [...nav.querySelectorAll("a")].map((link) => {
            const box = link.getBoundingClientRect();
            const label = link.querySelector("span:not([aria-hidden])")!.getBoundingClientRect();

            return {
              name: link.textContent,
              inside: box.left >= bar.left - 0.5 && box.right <= bar.right + 0.5,
              labelInside: label.left >= box.left - 0.5 && label.right <= box.right + 0.5,
              scrollOverflow: link.scrollWidth - link.clientWidth,
            };
          }),
        };
      }, NAV);

      expect(result.pageOverflow).toBeLessThanOrEqual(0);
      for (const link of result.links) {
        expect(link.inside, `${link.name}: poza paskiem`).toBe(true);
        expect(link.labelInside, `${link.name}: etykieta poza pozycją`).toBe(true);
        expect(link.scrollOverflow, `${link.name}: przepełnienie`).toBeLessThanOrEqual(0);
      }

      await page.context().close();
    });
  }
});
