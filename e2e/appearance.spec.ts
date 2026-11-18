import { expect, test, type Page } from "@playwright/test";

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
