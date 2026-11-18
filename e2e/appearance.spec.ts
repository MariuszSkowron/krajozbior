import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

// E3-1: motyw (nocny domyślny, jasny z ciasteczka), przełącznik w nagłówku (także bez JavaScriptu),
// kroje z polskimi znakami i podkreślenie linków w tekście. Nie potrzebuje bazy danych.
const COOKIE = "krajozbior-theme";

async function setThemeCookie(page: Page, value: string) {
  await page.context().addCookies([{ name: COOKIE, value, url: "http://127.0.0.1" }]);
}

function htmlClass(page: Page) {
  return page.evaluate(() => document.documentElement.className);
}

test.describe("motyw", () => {
  test("bez ciasteczka strona startuje w motywie nocnym z krojami z projektu", async ({ page }) => {
    await page.goto("/");

    expect(await htmlClass(page)).toContain("theme-dark");
    const styles = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
      text: getComputedStyle(document.body).fontFamily,
      scheme: getComputedStyle(document.documentElement).colorScheme,
    }));
    expect(styles.background).toBe("rgb(11, 13, 18)");
    // next/font nadaje rodzinie nazwę eksportu (instrumentSerif); faktyczny krój sprawdza test CDP niżej.
    expect(styles.heading).toMatch(/^instrumentSerif,/);
    expect(styles.text).toMatch(/^geist,/);
    expect(styles.scheme).toBe("dark");
  });

  test("ciasteczko light daje motyw jasny, nieznana wartość motyw nocny", async ({ page }) => {
    await setThemeCookie(page, "light");
    await page.goto("/");
    expect(await htmlClass(page)).toContain("theme-light");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      "rgb(244, 242, 236)",
    );

    await setThemeCookie(page, "xyz");
    await page.goto("/");
    expect(await htmlClass(page)).toContain("theme-dark");
  });

  test("ustawienie jasne w systemie nie zmienia motywu", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/");

    expect(await htmlClass(page)).toContain("theme-dark");
    await context.close();
  });

  test("pierwsza odpowiedź HTML (bez JavaScriptu) niesie klasę motywu i kolor paska", async ({
    request,
  }) => {
    const night = await (await request.get("/")).text();
    expect(night).toMatch(/<html[^>]*class="theme-dark /);
    expect(night).toContain('<meta name="theme-color" content="#0B0D12"');

    const light = await (await request.get("/", { headers: { cookie: `${COOKIE}=light` } })).text();
    expect(light).toMatch(/<html[^>]*class="theme-light /);
    expect(light).toContain('<meta name="theme-color" content="#F4F2EC"');
  });
});

test.describe("przełącznik motywu", () => {
  test("gość przełącza motyw, napis się zmienia i wybór zostaje po przeładowaniu", async ({
    page,
  }) => {
    await page.goto("/");
    const toLight = page.getByRole("banner").getByRole("button", { name: "Jasny motyw" });
    const box = await toLight.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await toLight.click();
    await expect(page.locator("html")).toHaveClass(/theme-light/);
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Nocny motyw" }),
    ).toBeVisible();

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/theme-light/);

    await page.getByRole("banner").getByRole("button", { name: "Nocny motyw" }).click();
    await expect(page.locator("html")).toHaveClass(/theme-dark/);
  });

  test.describe("bez JavaScriptu", () => {
    test.use({ javaScriptEnabled: false });

    test("zwykłe wysłanie formularza zmienia motyw", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("banner").getByRole("button", { name: "Jasny motyw" }).click();

      await expect(page.locator("html")).toHaveClass(/theme-light/);
      await expect(
        page.getByRole("banner").getByRole("button", { name: "Nocny motyw" }),
      ).toBeVisible();
    });
  });

  test("na telefonie przycisk ma 44 × 44 px i nazwę dostępną", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");

    const button = page.getByRole("banner").getByRole("button", { name: "Jasny motyw" });
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("kroje i linki", () => {
  // CSS.getPlatformFontsForNode zwraca kroje faktycznie użyte do narysowania tekstu
  // (document.fonts.check tego nie rozróżnia).
  test("polskie znaki są rysowane krojami z projektu, bez zapasowych", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      document.querySelector("main")!.innerHTML = `
        <h1 id="t">Żółć, Gdańsk, Łódź</h1>
        <h1 id="ti"><em>Żółć, Gdańsk, Łódź</em></h1>
        <p id="p">Żółć, Gdańsk, Łódź</p>
        <p id="l" class="eyebrow">Żółć, Gdańsk, Łódź</p>`;
    });
    await page.evaluate(() => document.fonts.ready);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");

    async function platformFonts(selector: string) {
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      return fonts.map((font) => font.familyName);
    }

    expect(await platformFonts("#t")).toEqual(["Instrument Serif"]);
    expect(await platformFonts("#ti")).toEqual(["Instrument Serif"]);
    expect(await platformFonts("#p")).toEqual(["Geist"]);
    expect(await platformFonts("#l")).toEqual(["Geist Mono"]);
  });

  test("obwódka fokusu przycisku głównego zostaje widoczna po najechaniu myszą", async ({
    page,
  }) => {
    await page.goto("/");
    // Po hydratacji React nie nadpisze wstrzykniętego przycisku.
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      document.querySelector("main")!.innerHTML =
        '<button id="primary" class="button button--primary">Dalej</button>';
    });

    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.id === "primary")) break;
    }
    const primary = page.locator("#primary");
    await expect(primary).toBeFocused();
    await primary.hover();

    const outline = await primary.evaluate((element) => {
      const style = getComputedStyle(element);
      // Kolor tokenu fokusu przeliczony przez przeglądarkę na rgb(...) (token sam bywa zapisany jako var()).
      const probe = document.createElement("span");
      probe.style.color = "var(--color-border-focus)";
      document.body.append(probe);
      const focusColor = getComputedStyle(probe).color;
      probe.remove();
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        color: style.outlineColor,
        focusColor,
      };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBe("2px");
    expect(outline.focusColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(outline.color).toBe(outline.focusColor);
  });

  for (const theme of ["dark", "light"]) {
    test(`link w akapicie jest podkreślony, nazwa aplikacji nie (motyw ${theme})`, async ({
      page,
    }) => {
      await setThemeCookie(page, theme);
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => {
        document.querySelector("main")!.innerHTML =
          '<p><a id="in-text" href="#x">pełny opis</a></p>';
      });

      const underline = (selector: string) =>
        page.evaluate(
          (s) => getComputedStyle(document.querySelector(s)!).textDecorationLine,
          selector,
        );
      expect(await underline("#in-text")).toBe("underline");
      expect(await underline("header a")).toBe("none");
    });
  }
});

// E3-2b: test dostępności (axe) wszystkich ekranów ścieżki w obu motywach, ruch i reguła tła.
// Potrzebuje bazy po `db:seed:demo` (kolekcja demo, konta demo); bez niej jest pomijany.
// Axe działa z `reducedMotion: "reduce"` (stan końcowy animacji jest ten sam, a środek animacji
// dawałby fałszywe naruszenia kontrastu); osobny test sprawdza, że animacje kończą się stanem końcowym.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const DEMO_TITLE = "Mosty i zamki nad Wisłą (demo)";
const EXPLORER = "user2@demo.krajozbior.local";
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type Who = "guest" | "explorer" | "curator";

const states: { explorer?: StorageState; curator?: StorageState } = {};
const paths = { place: "", editor: "", placeEditor: "" };

async function signIn(browser: Browser, name: string): Promise<StorageState> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/login");
  const form = page.locator("form", { has: page.getByLabel("Hasło") });
  await form.getByLabel("E-mail").fill(`${name}@demo.krajozbior.local`);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);
  const state = await context.storageState();

  await context.close();

  return state;
}

async function adminQuery(sql: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });

  await client.connect();
  try {
    await client.query(sql, params);
  } finally {
    await client.end();
  }
}

// Co test zapisał dla konta user2 (zapisana kolekcja, miejsce na liście), kasuje po sobie.
async function cleanUpExplorer() {
  for (const table of ["visits", "saved_collections", "want_to_see_places"]) {
    await adminQuery(
      `delete from public.${table} where user_id in (select id from auth.users where email = $1)`,
      [EXPLORER],
    );
  }
}

async function openScreen(
  browser: Browser,
  who: Who,
  theme: string,
  viewport: { width: number; height: number },
  path: string,
  reducedMotion: "reduce" | "no-preference" = "reduce",
) {
  const context = await browser.newContext({
    viewport,
    reducedMotion,
    storageState: who === "guest" ? undefined : states[who],
  });

  await context.addCookies([{ name: COOKIE, value: theme, url: "http://127.0.0.1" }]);
  const page = await context.newPage();

  await page.goto(path);
  await page.waitForLoadState("networkidle");

  return { context, page };
}

async function axeViolations(page: Page) {
  await page.addScriptTag({ content: axe.source });

  return page.evaluate(async (tags) => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: tags },
    });

    return result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => `${node.target.join(" ")}: ${node.failureSummary}`),
    }));
  }, AXE_TAGS);
}

test.describe("wygląd ekranów: axe, ruch, reguła tła", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD i zasiana baza są wymagane");

  test.beforeAll(async ({ browser }) => {
    await cleanUpExplorer();
    states.explorer = await signIn(browser, "user2");
    states.curator = await signIn(browser, "curator-a");

    // Odkrywca zapisuje kolekcję demo i pierwsze miejsce na liście „Chcę zobaczyć”,
    // żeby ekrany „Moje kolekcje” i „Chcę zobaczyć” miały zawartość.
    const { context, page } = await openScreen(
      browser,
      "explorer",
      "dark",
      PHONE,
      `/collections/${DEMO_SLUG}`,
    );
    const placeHref = await page.locator("ol li a").first().getAttribute("href");

    paths.place = placeHref ?? "";
    await page.getByRole("button", { name: "Zapisz kolekcję" }).click();
    await expect(page.getByText("Ta kolekcja jest w Twoich zapisanych.")).toBeVisible();
    await page.goto(paths.place);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Chcę zobaczyć", exact: true }).click();
    await expect(page.getByText("To miejsce jest na Twojej liście")).toBeVisible();
    await context.close();

    const curator = await openScreen(browser, "curator", "dark", DESKTOP, "/curator");

    paths.editor =
      (await curator.page.getByRole("link", { name: DEMO_TITLE }).first().getAttribute("href")) ??
      "";
    await curator.page.goto(paths.editor);
    paths.placeEditor =
      (await curator.page
        .locator('a[href*="/places/"]:not([href$="/new"])')
        .first()
        .getAttribute("href")) ?? "";
    await curator.context.close();
  });

  test.afterAll(cleanUpExplorer);

  const screens: { name: string; who: Who; path: () => string; widths: (typeof PHONE)[] }[] = [
    { name: "strona startowa", who: "guest", path: () => "/", widths: [PHONE, DESKTOP] },
    { name: "logowanie", who: "guest", path: () => "/login", widths: [PHONE] },
    {
      name: "kolekcja",
      who: "explorer",
      path: () => `/collections/${DEMO_SLUG}`,
      widths: [PHONE, DESKTOP],
    },
    { name: "miejsce", who: "explorer", path: () => paths.place, widths: [PHONE, DESKTOP] },
    {
      name: "Moje kolekcje",
      who: "explorer",
      path: () => "/my/collections",
      widths: [PHONE, DESKTOP],
    },
    { name: "Chcę zobaczyć", who: "explorer", path: () => "/my/want-to-see", widths: [PHONE] },
    { name: "panel kuratora", who: "curator", path: () => "/curator", widths: [DESKTOP] },
    { name: "edytor kolekcji", who: "curator", path: () => paths.editor, widths: [DESKTOP] },
    { name: "edytor miejsca", who: "curator", path: () => paths.placeEditor, widths: [DESKTOP] },
  ];

  for (const screen of screens) {
    for (const viewport of screen.widths) {
      for (const theme of ["dark", "light"]) {
        test(`${screen.name}, ${viewport.width} px, motyw ${theme}: axe bez naruszeń, bez animacji`, async ({
          browser,
        }) => {
          const { context, page } = await openScreen(
            browser,
            screen.who,
            theme,
            viewport,
            screen.path(),
          );

          await expect(page.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));
          expect(await axeViolations(page)).toEqual([]);

          // Przy reducedMotion: reduce nic nie jest animowane, a przycisk główny nie ma przejścia.
          expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
          const primary = page.locator("main .button--primary").first();

          if ((await primary.count()) > 0) {
            expect(await primary.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe(
              "0s",
            );
          }
          await context.close();
        });
      }
    }
  }

  test("bez redukcji ruchu wejście sekcji kończy się stanem końcowym", async ({ browser }) => {
    const { context, page } = await openScreen(
      browser,
      "guest",
      "dark",
      PHONE,
      "/",
      "no-preference",
    );

    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const style = await page.evaluate(() => {
      const section = document.querySelector("main section")!;
      const computed = getComputedStyle(section);

      return { opacity: computed.opacity, transform: computed.transform };
    });

    expect(style).toEqual({ opacity: "1", transform: "none" });
    await context.close();
  });

  test("wiersz listy z linkiem nie zmienia tła po najechaniu (reguła tła)", async ({ browser }) => {
    for (const theme of ["dark", "light"]) {
      const { context, page } = await openScreen(
        browser,
        "explorer",
        theme,
        DESKTOP,
        "/my/want-to-see",
      );
      const row = page.locator("ul li").first();
      const link = row.getByRole("link");
      const backgrounds = () =>
        page.evaluate(() => {
          const li = document.querySelector("main ul li")!;

          return [li, li.querySelector("a")!].map((el) => getComputedStyle(el).backgroundColor);
        });
      const before = await backgrounds();

      await link.hover();
      await page.waitForTimeout(500);
      expect(await backgrounds()).toEqual(before);
      await context.close();
    }
  });
});
