import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

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
    await waitForHydration(page);
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
    await waitForHydration(page);
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
      await waitForHydration(page);
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
  await page.getByText("Logowanie hasłem").click();
  const form = page.locator("form", { has: page.getByLabel("Hasło") });
  await form.getByLabel("E-mail").fill(`${name}@demo.krajozbior.local`);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  // A curator lands in the panel, everyone else on the profile (paczka N, faza 2).
  await expect(page).toHaveURL(
    name.startsWith("curator") ? /\/curator$/ : /^https?:\/\/[^/]+\/(my)?$/,
  );
  const state = await context.storageState();

  await context.close();

  return state;
}

async function adminQuery(sql: string, params: unknown[] = []) {
  // Kasuje wiersze konta demo, więc działa tylko na jednorazowej bazie testowej (nigdy na deweloperskiej).
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

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
  options: BrowserContextOptions = {},
) {
  const context = await browser.newContext({
    ...options,
    viewport,
    reducedMotion,
    storageState: who === "guest" ? undefined : states[who],
  });

  await context.addCookies([{ name: COOKIE, value: theme, url: "http://127.0.0.1" }]);
  const page = await context.newPage();

  await page.goto(path);
  await waitForHydration(page);

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
    // Most Tczewski: znane położenie, potrzebne w stanach potwierdzenia wizyty niżej.
    const placeHref = await page
      .getByRole("link", { name: /Most Tczewski/ })
      .first()
      .getAttribute("href");

    paths.place = placeHref ?? "";
    await page.getByRole("button", { name: "Zapisuję kolekcję" }).click();
    await expect(page.getByText("Kolekcja jest zapisana.")).toBeVisible();
    await page.goto(paths.place);
    await waitForHydration(page);
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

  test("panel kuratora: odznaka stoi na karcie, a wiersz tabeli nie zmienia tła po najechaniu", async ({
    browser,
  }) => {
    for (const theme of ["dark", "light"]) {
      const { context, page } = await openScreen(browser, "curator", theme, DESKTOP, "/curator");
      const badge = page.locator("main table tbody tr td:nth-child(2) > *").first();
      const row = page.locator("main table tbody tr").first();
      const cardColor = await page.evaluate(() => {
        const probe = document.createElement("span");

        probe.style.backgroundColor = "var(--color-surface-card)";
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;

        probe.remove();

        return color;
      });
      // Pierwsze nieprzezroczyste tło w górę drzewa od odznaki (tło, na którym odznaka faktycznie stoi).
      const surfaceUnderBadge = () =>
        badge.evaluate((el) => {
          for (let node: Element | null = el.parentElement; node; node = node.parentElement) {
            const color = getComputedStyle(node).backgroundColor;

            if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
              return color;
            }
          }

          return "none";
        });
      const rowBackgrounds = () =>
        row.evaluate((tr) =>
          [tr, ...tr.querySelectorAll("th, td")].map((el) => getComputedStyle(el).backgroundColor),
        );

      expect(await surfaceUnderBadge()).toBe(cardColor);
      const before = await rowBackgrounds();

      await row.hover();
      await page.waitForTimeout(500);
      expect(await rowBackgrounds()).toEqual(before);
      expect(await surfaceUnderBadge()).toBe(cardColor);
      await context.close();
    }
  });

  // Stany z nowymi kolorami (ostrzeżenie, błąd, sukces, odznaka „Odwiedzone”, 404): axe, motyw
  // nocny, telefon. Lokalizacja jest ustawiana w kontekście; wizyta konta user2 jest sprzątana po teście.
  const BRIDGE = { latitude: 54.0928, longitude: 18.7919, accuracy: 20 };
  const FAR = { latitude: 54.1468, longitude: 18.7919, accuracy: 20 };

  async function placeWithLocation(
    browser: Browser,
    location: { latitude: number; longitude: number; accuracy: number } | null,
    theme: "dark" | "light" = "dark",
  ) {
    const opened = await openScreen(browser, "explorer", theme, PHONE, paths.place, "reduce", {
      permissions: location ? ["geolocation"] : [],
      geolocation: location ?? undefined,
    });

    await opened.page.getByRole("button", { name: "Potwierdzam wizytę" }).click();

    return opened;
  }

  const DOCK = "[data-pinned-action]";
  const NAV_BAR = 'nav[aria-label="Główna"]';

  // Odstęp między końcem treści a górną krawędzią przypiętego przycisku po przewinięciu na dół
  // (>= 0: treść nie chowa się pod przyciskiem). Komunikat nad przyciskiem powiększa pasek, więc
  // pomiar po komunikacie sprawdza też, że rezerwa pod przycisk rośnie razem z nim.
  async function contentGap(page: Page) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

    return page.evaluate((dockSelector) => {
      const dockTop = document.querySelector(dockSelector)!.getBoundingClientRect().top;
      const last = [...document.querySelectorAll("main *")]
        .filter((el) => !el.closest(dockSelector))
        .map((el) => el.getBoundingClientRect())
        .filter((rect) => rect.height > 0)
        .reduce((max, rect) => Math.max(max, rect.bottom), 0);

      return dockTop - last;
    }, DOCK);
  }

  for (const theme of ["dark", "light"] as const) {
    test(`miejsce: komunikat „za daleko” w przypiętym pasku (ostrzeżenie), motyw ${theme}, axe bez naruszeń`, async ({
      browser,
    }) => {
      const { context, page } = await placeWithLocation(browser, FAR, theme);
      const status = page.getByRole("status").filter({ hasText: /Jesteś .* km od miejsca\./ });

      await expect(status).toBeVisible();
      await expect(page.getByRole("button", { name: "Sprawdź ponownie" })).toBeVisible();
      expect(await contentGap(page)).toBeGreaterThanOrEqual(0);
      expect(await axeViolations(page)).toEqual([]);
      await context.close();
    });

    test(`miejsce: stan wyjściowy z przypiętym przyciskiem, motyw ${theme}, axe bez naruszeń`, async ({
      browser,
    }) => {
      const { context, page } = await openScreen(browser, "explorer", theme, PHONE, paths.place);

      await expect(page.getByRole("button", { name: "Potwierdzam wizytę" })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await context.close();
    });
  }

  // Przypięty przycisk główny ekranu miejsca (telefon): zastępuje dolny pasek, jest widoczny po
  // przewinięciu i nie zasłania fokusu (WCAG 2.4.11; axe tego nie wykrywa).
  test("miejsce na telefonie: przycisk przypięty u dołu, pasek nawigacji ukryty, przycisk widoczny po przewinięciu", async ({
    browser,
  }) => {
    const { context, page } = await openScreen(browser, "explorer", "dark", PHONE, paths.place);

    await expect(page.locator(NAV_BAR)).toBeHidden();
    // Dolny margines treści: ostatni element strony kończy się nad przypiętym przyciskiem.
    expect(await contentGap(page)).toBeGreaterThanOrEqual(0);
    const button = page.getByRole("button", { name: "Potwierdzam wizytę" });

    await expect(button).toBeInViewport({ ratio: 1 });
    const box = (await button.boundingBox())!;

    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
    await context.close();
  });

  // Regresja M1: sekcja z przyciskiem ma animację wejścia (przesunięcie `transform` tworzy blok
  // zawierający dla `position: fixed`), więc przez czas animacji przycisk leżałby na dole sekcji,
  // nie okna. Test działa z włączonym ruchem (`no-preference`), a animacje wydłuża do 5 s, żeby
  // pomiar zaraz po wczytaniu na pewno wypadł w jej trakcie (bez tego wynik zależałby od tempa
  // maszyny); sprawdza też, że animacja faktycznie trwa.
  test("miejsce na telefonie: przycisk przylega do dołu okna także w trakcie animacji wejścia", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: PHONE,
      reducedMotion: "no-preference",
      storageState: states.explorer,
    });

    await context.addCookies([{ name: COOKIE, value: "dark", url: "http://127.0.0.1" }]);
    await context.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");

        style.textContent = "*, *::before, *::after { animation-duration: 5s !important; }";
        document.head.append(style);
      });
    });
    const page = await context.newPage();

    await page.goto(paths.place, { waitUntil: "domcontentloaded" });
    await page.locator(DOCK).waitFor();
    const state = await page.evaluate((dockSelector) => {
      const dock = document.querySelector(dockSelector)!;

      return {
        bottom: dock.getBoundingClientRect().bottom,
        innerHeight: window.innerHeight,
        // The entrance animates the child of the page frame that holds the dock (since R3 the
        // two-column block, not the visit section): look at exactly that element.
        sectionAnimations:
          dock
            .closest(".content-width-wide > *, .content-width > *")
            ?.getAnimations()
            .filter((animation) => animation.playState === "running").length ?? 0,
      };
    }, DOCK);

    expect(state.sectionAnimations, "animacja wejścia sekcji ma jeszcze trwać").toBeGreaterThan(0);
    expect(state.bottom).toBeCloseTo(state.innerHeight, 0);
    await context.close();
  });

  test("miejsce na komputerze: bez zmian, pasek boczny widoczny, przycisk w karcie", async ({
    browser,
  }) => {
    const { context, page } = await openScreen(browser, "explorer", "dark", DESKTOP, paths.place);

    await expect(page.locator(NAV_BAR)).toBeVisible();
    // Opakowanie jest przezroczyste (`display: contents`), a przycisk leży w karcie „Wizyta”.
    const layout = await page
      .getByRole("button", { name: "Potwierdzam wizytę" })
      .evaluate((button, dockSelector) => {
        const dock = button.closest(dockSelector)!;
        const card = dock.parentElement!.getBoundingClientRect();
        const rect = button.getBoundingClientRect();

        return {
          display: getComputedStyle(dock).display,
          inCard:
            rect.top >= card.top &&
            rect.bottom <= card.bottom &&
            rect.left >= card.left &&
            rect.right <= card.right,
        };
      }, DOCK);

    expect(layout).toEqual({ display: "contents", inCard: true });
    await context.close();
  });

  // Tab przez całą stronę; zwraca opisy elementów zasłoniętych przez przypięty przycisk albo
  // leżących pod jego górną krawędzią. Pierwszy element treści (poza paskiem) jest odsunięty
  // tak, by jego dół był 4 px POD górną krawędzią przycisku (zachodzi na niego, ale w całości
  // mieści się w oknie): bez `scroll-padding-bottom` przeglądarka go nie przewinie, a za mały
  // (np. stara wysokość paska nawigacji zamiast wysokości przycisku) też nie, bo 4 px zakładki
  // wymaga rezerwy równej wysokości przycisku.
  async function coveredFocus(page: Page, theme: string) {
    await page.evaluate((dockSelector) => {
      const target = [...document.querySelectorAll<HTMLElement>("main a[href], main button")].find(
        (el) => !el.closest(dockSelector),
      )!;
      const dockTop = document.querySelector(dockSelector)!.getBoundingClientRect().top;
      const spacer = document.createElement("div");

      spacer.style.height = "0px";
      target.parentElement!.insertBefore(spacer, target);
      // Przerwa siatki rodzica wchodzi w pozycję elementu, więc dopasowanie liczy się z pomiaru.
      spacer.style.height = `${dockTop + 4 - target.getBoundingClientRect().bottom}px`;
    }, DOCK);

    const problems: string[] = [];
    let checked = 0;

    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const state = await page.evaluate((dockSelector) => {
        const element = document.activeElement as HTMLElement;
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        const dock = document.querySelector(dockSelector)!;

        return {
          label: `${element.tagName} ${element.textContent?.trim().slice(0, 30) ?? ""}`,
          inMain: element.closest("main") !== null,
          inDock: dock.contains(element),
          covered: !(hit === element || element.contains(hit)),
          aboveDock: box.bottom <= dock.getBoundingClientRect().top,
        };
      }, DOCK);

      if (state.inMain && !state.inDock) {
        checked += 1;
        if (state.covered || !state.aboveDock) {
          problems.push(`${theme}, Tab ${i + 1}: ${state.label}`);
        }
      }
    }

    expect(checked, "w treści powinien być element z fokusem").toBeGreaterThan(0);

    return problems;
  }

  for (const theme of ["dark", "light"] as const) {
    test(`miejsce na telefonie: fokus nie jest zasłonięty przez przypięty przycisk (motyw ${theme})`, async ({
      browser,
    }) => {
      const { context, page } = await openScreen(browser, "explorer", theme, PHONE, paths.place);

      expect(await coveredFocus(page, theme)).toEqual([]);
      await context.close();
    });
  }

  // Pasek z komunikatem „za daleko” jest wyższy niż sam przycisk (ok. 130 px), więc rezerwa musi
  // pochodzić z pomiaru paska (`--pinned-action-height`), a nie z minimum: ten stan wykrywa brak
  // nadpisania `--shell-bottom-bar-height` na ekranie miejsca (stan wyjściowy go nie wykrywa,
  // bo minimum paska nawigacji 50 px plus odstęp przypadkiem wystarcza dla samego przycisku).
  test("miejsce na telefonie: fokus nie jest zasłonięty przez wyższy pasek z komunikatem „za daleko”", async ({
    browser,
  }) => {
    const { context, page } = await placeWithLocation(browser, FAR);

    await expect(
      page.getByRole("status").filter({ hasText: /Jesteś .* km od miejsca\./ }),
    ).toBeVisible();
    expect(await coveredFocus(page, "dark, za daleko")).toEqual([]);
    await context.close();
  });

  // Kontrola metody pomiaru, nie funkcji: bez `scroll-padding-bottom` ten sam pomiar wykrywa
  // zasłonięty fokus (chroni przed testem „zielonym, bo nic nie mierzy”).
  test("miejsce na telefonie: bez scroll-padding test zasłonięcia fokusu wykrywa błąd", async ({
    browser,
  }) => {
    const { context, page } = await openScreen(browser, "explorer", "dark", PHONE, paths.place);

    await page.addStyleTag({ content: "html { scroll-padding-bottom: 0 !important; }" });
    expect((await coveredFocus(page, "dark")).length).toBeGreaterThan(0);
    await context.close();
  });

  test("miejsce: błąd lokalizacji (alert), axe bez naruszeń", async ({ browser }) => {
    const { context, page } = await placeWithLocation(browser, null);

    await expect(
      page.getByRole("alert").filter({ hasText: "Nie mamy zgody na lokalizację." }),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await context.close();
  });

  test("miejsce: wizyta potwierdzona, odznaka „Odwiedzone” i lista „Chcę zobaczyć”, axe bez naruszeń", async ({
    browser,
  }) => {
    const { context, page } = await placeWithLocation(browser, BRIDGE);

    await expect(page.getByText("Most Tczewski jest w Twoim albumie.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await page.reload();
    await waitForHydration(page);
    await expect(page.getByText("Odwiedzone", { exact: true }).first()).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await page.goto("/my/want-to-see");
    await waitForHydration(page);
    await expect(page.getByText("Odwiedzone", { exact: true }).first()).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await context.close();
  });

  test("not-found (404): axe bez naruszeń", async ({ browser }) => {
    const { context, page } = await openScreen(browser, "guest", "dark", PHONE, "/nie-ma-takiej");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await context.close();
  });
});
