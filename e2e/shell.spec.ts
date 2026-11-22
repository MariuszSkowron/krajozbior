import { expect, test, type Browser, type Page } from "@playwright/test";

import { waitForHydration } from "../tests/support/e2e-hydration";

// E3-2a: powłoka i nawigacja. Dolny pasek zalogowanego odkrywcy na telefonie (5 pozycji,
// aria-current, cele dotykowe 44 × 44 px, fokus niezasłonięty przez pasek), menu boczne
// na komputerze oraz menu i komunikat panelu kuratora. Logowanie kontami demo wymaga
// zmigrowanej i zasianej bazy jak w innych specach; bez niej te testy są pomijane.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const NAV = 'nav[aria-label="Główna"]';
const emailOf = (name: string) => `${name}@demo.krajozbior.local`;

async function signedInPage(
  browser: Browser,
  name: string,
  viewport: { width: number; height: number },
  theme: "dark" | "light" = "dark",
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" }]);
  const page = await context.newPage();

  await page.goto("/login");

  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(emailOf(name));
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(name.startsWith("curator") ? /\/curator$/ : /\/my$/);

  return page;
}

test.describe("gość", () => {
  test("nie ma głównej nawigacji, tylko nagłówek z aktualnościami i logowaniem", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.locator(NAV)).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("link", { name: "Zaloguj się" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Aktualności" })).toBeVisible();
    await context.close();
  });
});

test.describe("dolny pasek na telefonie", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("ma 5 pozycji, bieżąca ma aria-current, cele mają co najmniej 44 × 44 px", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, "user", PHONE);
    const nav = page.locator(NAV);

    await expect(nav.getByRole("link")).toHaveText([
      "Start",
      "Moje kolekcje",
      "Chcę zobaczyć",
      "Profil",
      "Aktualności",
    ]);

    // Pasek jest przypięty do dolnej krawędzi i ma półprzezroczyste tło z rozmyciem.
    const bar = await nav.evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        position: style.position,
        backdrop: style.backdropFilter,
        bottom: box.bottom,
        height: box.height,
        viewport: window.innerHeight,
      };
    });
    expect(bar.position).toBe("fixed");
    expect(bar.backdrop).toContain("blur");
    expect(bar.bottom).toBe(bar.viewport);
    expect(bar.height).toBeGreaterThanOrEqual(50);

    for (const [path, name] of [
      ["/my", "Profil"],
      ["/my/collections", "Moje kolekcje"],
      ["/my/want-to-see", "Chcę zobaczyć"],
    ] as const) {
      await page.goto(path);
      const current = nav.locator('a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(name);
    }

    for (const link of await nav.getByRole("link").all()) {
      const box = await link.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    // Aktywny napis ma kolor strong (D-23), nie akcent; akcentem jest ikona.
    const colors = await page.evaluate(() => {
      const link = document.querySelector('nav a[aria-current="page"]')!;
      const probe = document.createElement("span");
      probe.style.color = "var(--color-text-strong)";
      document.body.append(probe);
      const strong = getComputedStyle(probe).color;
      probe.remove();
      return { label: getComputedStyle(link).color, strong };
    });
    expect(colors.label).toBe(colors.strong);
    await page.context().close();
  });

  test("przy tekście powiększonym do 200% rezerwa pod pasek nadąża za jego wysokością", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, "user", { width: 320, height: 640 });
    await page.addStyleTag({ content: "html { font-size: 200%; }" });

    for (const path of ["/my/collections", "/my/want-to-see"]) {
      await page.goto(path);
      await page.addStyleTag({ content: "html { font-size: 200%; }" });
      await waitForHydration(page);

      // Etykieta zawija się i pasek rośnie ponad 50 px; treść i przewijanie do fokusu muszą
      // zostawiać pod spodem co najmniej tyle miejsca, ile zajmuje pasek.
      const sizes = await page.evaluate((navSelector) => {
        const bar = document.querySelector(navSelector)!.getBoundingClientRect().height;
        return {
          bar,
          scroll: Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
          padding: Number.parseFloat(
            getComputedStyle(document.querySelector("main")!).paddingBottom,
          ),
        };
      }, NAV);
      expect(sizes.bar, `${path}: pasek powinien urosnąć ponad 50 px`).toBeGreaterThan(50);
      expect(sizes.scroll, `${path}: scroll-padding-bottom`).toBeGreaterThanOrEqual(sizes.bar);
      expect(sizes.padding, `${path}: padding-bottom treści`).toBeGreaterThanOrEqual(sizes.bar);

      // Ostatni element treści po przewinięciu do końca stoi nad paskiem.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const gap = await page.evaluate((navSelector) => {
        const barTop = document.querySelector(navSelector)!.getBoundingClientRect().top;
        const main = document.querySelector("main")!;
        const last = [...main.querySelectorAll("*")]
          .map((element) => element.getBoundingClientRect())
          .filter((box) => box.height > 0)
          .reduce((max, box) => Math.max(max, box.bottom), 0);
        return barTop - last;
      }, NAV);
      expect(gap, `${path}: treść schowana pod paskiem`).toBeGreaterThanOrEqual(0);
    }
    await page.context().close();
  });

  for (const theme of ["dark", "light"] as const) {
    test(`fokus nie jest zasłonięty przez dolny pasek (motyw ${theme})`, async ({ browser }) => {
      const page = await signedInPage(browser, "user", PHONE, theme);

      for (const path of ["/my/collections", "/my/want-to-see"]) {
        await page.goto(path);
        await waitForHydration(page);
        // Odstęp przed treścią ustawia pierwszy element z fokusem tuż nad dolną krawędzią
        // ekranu, czyli pod paskiem, ale w całości w oknie przeglądarki. Przeglądarka przewija
        // do fokusu tylko element, który uważa za niewidoczny; bez scroll-padding-bottom
        // pierwszy element zostałby pod paskiem.
        await page.evaluate(() => {
          const first = document.querySelector<HTMLElement>(
            "main a[href], main button, main input, main select, main textarea",
          )!;
          const box = first.getBoundingClientRect();
          const spacer = document.createElement("div");
          spacer.style.height = `${window.innerHeight - box.height - 2 - box.top}px`;
          document.querySelector("main")!.prepend(spacer);
        });

        let checked = 0;
        for (let i = 0; i < 40; i += 1) {
          await page.keyboard.press("Tab");
          const state = await page.evaluate((navSelector) => {
            const element = document.activeElement as HTMLElement;
            const box = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );
            return {
              inMain: element.closest("main") !== null,
              covered: !(hit === element || element.contains(hit)),
              aboveBar:
                box.bottom <= document.querySelector(navSelector)!.getBoundingClientRect().top,
            };
          }, NAV);

          if (state.inMain) {
            checked += 1;
            expect(state.covered, `${path}, Tab ${i + 1}: element zasłonięty`).toBe(false);
            expect(state.aboveBar, `${path}, Tab ${i + 1}: element pod paskiem`).toBe(true);
          }
        }
        expect(checked, `${path}: w treści powinien być element z fokusem`).toBeGreaterThan(0);
      }
      await page.context().close();
    });
  }
});

test.describe("menu boczne na komputerze", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("menu stoi obok treści, ma 5 pozycji po 46 px i bieżącą z aria-current", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, "user", DESKTOP);
    await page.goto("/my/collections");
    const nav = page.locator(NAV);

    await expect(nav.getByRole("link")).toHaveCount(5);
    await expect(nav.locator('a[aria-current="page"]')).toHaveText("Moje kolekcje");

    const layout = await page.evaluate((navSelector) => {
      const navBox = document.querySelector(navSelector)!.getBoundingClientRect();
      const mainBox = document.querySelector("main")!.getBoundingClientRect();
      return {
        width: navBox.width,
        position: getComputedStyle(document.querySelector(navSelector)!).position,
        mainLeft: mainBox.left,
        navRight: navBox.right,
      };
    }, NAV);
    expect(layout.width).toBe(272);
    expect(layout.position).not.toBe("fixed");
    expect(layout.mainLeft).toBeGreaterThanOrEqual(layout.navRight);

    // Górny odstęp treści: 32 px od góry <main> do nagłówka strony (spec 5.6).
    await expect(page.getByRole("heading", { level: 1, name: "Moje kolekcje" })).toBeVisible();
    const top = await page.evaluate(
      () =>
        document.querySelector("main h1")!.getBoundingClientRect().top -
        document.querySelector("main")!.getBoundingClientRect().top,
    );
    expect(top).toBeGreaterThanOrEqual(32);

    for (const link of await nav.getByRole("link").all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(46);
    }
    await page.context().close();
  });
});

test.describe("panel kuratora", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("na komputerze ma własne menu z odznaką Kurator, a menu powłoki ustępuje", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, "curator-a", DESKTOP);
    await page.goto("/curator");

    const menu = page.getByRole("navigation", { name: "Panel kuratora" });
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Kurator", { exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Profil prywatny" })).toHaveAttribute(
      "href",
      "/my",
    );
    // Bieżąca pozycja menu panelu: jedna, z aria-current="page" na liście kolekcji.
    await expect(menu.locator("[aria-current]")).toHaveCount(1);
    await expect(menu.getByRole("link", { name: "Kolekcje" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(NAV)).toBeHidden();
    await page.context().close();
  });

  test("na telefonie pokazuje komunikat o komputerze zamiast panelu", async ({ browser }) => {
    const page = await signedInPage(browser, "curator-a", PHONE);
    await page.goto("/curator");

    await expect(page.getByRole("note")).toContainText(
      "Panel kuratora jest przeznaczony na komputer",
    );
    await expect(
      page.getByRole("note").getByRole("link", { name: "Przejdź do profilu" }),
    ).toHaveAttribute("href", "/my");
    await expect(page.getByRole("navigation", { name: "Panel kuratora" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Twoje kolekcje" })).toBeHidden();
    // Dolny pasek zostaje, żeby dało się wyjść z panelu.
    await expect(page.locator(NAV)).toBeVisible();
    await page.context().close();
  });
});

// Paczka N (K-12…K-16): nagłówek konta z imieniem albo „Profil”, etykieta kuratora na komputerze,
// „Wyloguj” jako akcja drugorzędna i nagłówek w jednym wierszu.
test.describe("nagłówek konta", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  const oneRow = async (page: Page) => {
    const tops = await page
      .getByRole("banner")
      .locator("a, button")
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.getBoundingClientRect().width > 0)
          .map((element) => Math.round(element.getBoundingClientRect().top / 10)),
      );

    expect(new Set(tops).size).toBe(1);
  };

  test("odkrywca widzi odnośnik do profilu zamiast nazwy roli, a „Wyloguj” jest drugorzędny", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, "user", PHONE);
    const banner = page.getByRole("banner");

    await expect(banner.getByRole("link", { name: /^Profil/ })).toHaveAttribute("href", "/my");
    await expect(banner).not.toContainText("Użytkownik");
    await expect(banner).not.toContainText("Twoja rola");
    await expect(banner.getByRole("link", { name: /^Kurator ·/ })).toHaveCount(0);

    const logout = banner.getByRole("button", { name: "Wyloguj" });
    expect((await logout.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await logout.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      "rgba(0, 0, 0, 0)",
    );
    await oneRow(page);
    await page.context().close();
  });

  test("kurator na komputerze widzi „Kurator · organizacja” prowadzące do panelu, na telefonie nie", async ({
    browser,
  }) => {
    const desktop = await signedInPage(browser, "curator-a", DESKTOP);
    const label = desktop.getByRole("banner").getByRole("link", { name: /^Kurator ·/ });

    await expect(label).toBeVisible();
    await expect(label).toHaveAttribute("href", "/curator");
    await oneRow(desktop);
    await desktop.context().close();

    const phone = await signedInPage(browser, "curator-a", PHONE);

    await expect(phone.getByRole("banner").getByRole("link", { name: /^Kurator ·/ })).toBeHidden();
    await expect(phone.getByRole("banner").getByRole("link", { name: /^Profil/ })).toBeVisible();
    await oneRow(phone);
    await phone.context().close();
  });

  test("profil kuratora opisuje rolę i prowadzi do panelu", async ({ browser }) => {
    const page = await signedInPage(browser, "curator-a", DESKTOP);

    // Po zalogowaniu kurator ląduje w panelu; profil otwiera się z menu panelu.
    await page.goto("/my");

    const main = page.getByRole("main");

    await expect(main).toContainText("Kurator ·");
    await expect(main.getByRole("link", { name: "Przejdź do panelu kuratora" })).toHaveAttribute(
      "href",
      "/curator",
    );
    await expect(main).toContainText("Tu są Twoje wizyty i liczby jako odkrywcy.");
    // Bez imienia kurator nie jest „Odkrywcą” nad własną rolą.
    await expect(main.getByTestId("profile-name")).toHaveText("Bez imienia");
    await expect(main.getByTestId("profile-name")).not.toContainText("Odkrywca");
    await page.context().close();
  });
});
