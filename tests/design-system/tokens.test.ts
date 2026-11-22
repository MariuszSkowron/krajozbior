import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { themeColor } from "@/app/shell/theme";
import { tokenNames, tokenVar } from "@/design-system/tokens/tokens";

const css = readFileSync(
  new URL("../../src/design-system/tokens/tokens.css", import.meta.url),
  "utf8",
);

type Theme = "dark" | "light";

// Bloki wybieramy po selektorze na początku wiersza (zagnieżdżone reguły @media są wcięte).
function block(selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace(/[.\\]/g, "\\$&")} \\{`, "m"));
  if (start === -1) throw new Error(`Brak bloku ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  return css.slice(open + 1, close);
}

function declarations(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]),
  );
}

const darkBlock = declarations(block(":root,\n.theme-dark"));
const lightBlock = declarations(block(".theme-light"));
const sharedBlock = declarations(block(":root"));

function raw(name: string, theme: Theme = "dark"): string {
  const value = (theme === "dark" ? darkBlock : lightBlock).get(name) ?? sharedBlock.get(name);
  if (value === undefined) throw new Error(`Brak tokenu --${name}`);
  const alias = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  return alias === null ? value : raw(alias[1], theme);
}

function token(name: string): string {
  return raw(name);
}

type Rgba = [number, number, number, number];

function rgba(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const n = parseInt(hex[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const fn = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(value);
  if (fn !== null) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), Number(fn[4]) / 100];
  throw new Error(`Nieobsługiwana wartość koloru: ${value}`);
}

function over(color: Rgba, background: Rgba): Rgba {
  const [r, g, b, a] = color;
  return [
    r * a + background[0] * (1 - a),
    g * a + background[1] * (1 - a),
    b * a + background[2] * (1 - a),
    1,
  ];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const color = (name: string, theme: Theme) => rgba(raw(name.replaceAll(".", "-"), theme));

// Kontrast koloru na tle (tła z kryciem nakładane na `base`, jeśli podano).
function contrast(fg: string, bg: string, theme: Theme, base?: string): number {
  const background = color(bg, theme);
  const solid = base === undefined ? background : over(background, color(base, theme));
  return ratio(over(color(fg, theme), solid), solid);
}

const themes: Theme[] = ["dark", "light"];
const surfaces = [
  "color.surface.canvas",
  "color.surface.card",
  "color.surface.tint",
  "color.surface.hover",
];

describe("motywy z jednych tokenów", () => {
  const themed = (names: Map<string, string>) =>
    [...names.keys()].filter((n) => n.startsWith("color-") || n.startsWith("shadow-")).sort();

  it("blok jasny definiuje dokładnie te same nazwy kolorów i cieni co nocny", () => {
    expect(themed(lightBlock)).toEqual(themed(darkBlock));
    expect(themed(darkBlock).length).toBeGreaterThan(20);
  });

  it("w blokach motywów są tylko kolory, cienie i alias fokusu", () => {
    for (const names of [darkBlock, lightBlock]) {
      expect([...names.keys()].filter((n) => !/^(color|shadow)-/.test(n))).toEqual([]);
    }
  });

  it("oba bloki ustawiają color-scheme", () => {
    expect(block(":root,\n.theme-dark")).toMatch(/color-scheme:\s*dark;/);
    expect(block(".theme-light")).toMatch(/color-scheme:\s*light;/);
  });

  it("blok jasny stoi po nocnym (ta sama specyficzność)", () => {
    expect(css.indexOf(".theme-light {")).toBeGreaterThan(css.indexOf(".theme-dark {"));
  });

  it("stała themeColor zgadza się z tłem strony w obu motywach", () => {
    for (const theme of themes) {
      expect(themeColor[theme].toLowerCase()).toBe(raw("color-surface-canvas", theme));
    }
  });
});

describe("kontrast tekstu (WCAG 2.x, pary dozwolone ≥ 4,5:1)", () => {
  const text = ["primary", "strong", "secondary", "label", "meta"].map((n) => `color.text.${n}`);
  const everywhere = [
    ...text,
    "color.feedback.warning",
    "color.feedback.danger",
    "color.feedback.info",
  ];
  const cases: [Theme, string, string][] = [];

  for (const theme of themes) {
    for (const fg of everywhere) for (const bg of surfaces) cases.push([theme, fg, bg]);
    // Akcent i zieleń: wszędzie w nocnym, a w jasnym tylko na canvas i card (reguła tła, D-22 Q5).
    const restricted = ["color.text.accent", "color.feedback.success"];
    for (const fg of restricted) {
      const allowed = theme === "dark" ? surfaces : surfaces.slice(0, 2);
      for (const bg of allowed) cases.push([theme, fg, bg]);
    }
  }

  it.each(cases)("%s: %s na %s", (theme, fg, bg) => {
    expect(contrast(fg, bg, theme)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["on-accent na accent (przycisk główny)", "color.text.on-accent", "color.brand.accent"],
    ["canvas na strong (wybrany chip)", "color.surface.canvas", "color.text.strong"],
    ["strong na border.default (wybrany segment)", "color.text.strong", "color.border.default"],
  ])("%s", (_label, fg, bg) => {
    for (const theme of themes) expect(contrast(fg, bg, theme)).toBeGreaterThanOrEqual(4.5);
  });

  // Pary niedozwolone (jasny motyw): test pilnuje, że lista jest prawdziwa; użycie którejkolwiek
  // z nich w regułach theme.css i modułach ekranów jest błędem (przegląd kodu).
  it.each([
    ["color.text.accent", "color.surface.tint"],
    ["color.text.accent", "color.surface.hover"],
    ["color.feedback.success", "color.surface.tint"],
  ])("niedozwolone (jasny): %s na %s ma poniżej 4,5:1", (fg, bg) => {
    expect(contrast(fg, bg, "light")).toBeLessThan(4.5);
  });
});

// Scena karty legendarnej (E6-4a, D-52): zawsze motyw nocny; tekst, nazwa kategorii i symbol
// mają stały kolor z tokenów tekstu na stałym tle karty, opalizacja jest tylko na ramce i w
// połysku, więc kontrast nie zależy od kategorii.
describe("scena karty legendarnej (motyw nocny)", () => {
  const cardText = ["strong", "primary", "secondary", "label", "meta"].map(
    (n) => `color.text.${n}`,
  );

  it.each(cardText)("%s na color.surface.card ≥ 4,5:1 (etykieta, nazwa kategorii, treść)", (fg) => {
    expect(contrast(fg, "color.surface.card", "dark")).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cardText)("%s na color.surface.canvas (tło zasłony i sceny) ≥ 4,5:1", (fg) => {
    expect(contrast(fg, "color.surface.canvas", "dark")).toBeGreaterThanOrEqual(4.5);
  });

  it("symbol kategorii (color.text.label) na color.surface.card ≥ 3:1", () => {
    expect(contrast("color.text.label", "color.surface.card", "dark")).toBeGreaterThanOrEqual(3);
  });
});

describe("odznaki stanu (tło stanu nałożone na tło)", () => {
  const states = ["success", "warning", "danger", "info"];
  // Dozwolone: wszystkie w nocnym; w jasnym ok tylko na card, warn i bad/info zależnie od tła.
  const forbiddenLight = new Set([
    "success|color.surface.canvas",
    "success|color.surface.tint",
    "success|color.surface.hover",
    "warning|color.surface.tint",
    "warning|color.surface.hover",
  ]);

  for (const theme of themes) {
    for (const state of states) {
      for (const base of surfaces) {
        const key = `${state}|${base}`;
        const bad = theme === "light" && forbiddenLight.has(key);
        it(`${theme}: ${state} na ${base} ${bad ? "(niedozwolone)" : ""}`, () => {
          const value = contrast(
            `color.feedback.${state}`,
            `color.feedback.${state}.bg`,
            theme,
            base,
          );
          if (bad) expect(value).toBeLessThan(4.5);
          else expect(value).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

describe("elementy nietekstowe (≥ 3:1)", () => {
  it.each(themes)("%s: obrys pola (color.text.meta) na tle pola i karty", (theme) => {
    expect(contrast("color.text.meta", "color.surface.canvas", theme)).toBeGreaterThanOrEqual(3);
    expect(contrast("color.text.meta", "color.surface.card", theme)).toBeGreaterThanOrEqual(3);
  });

  it.each(themes)("%s: obrys pola w podświetlonym wierszu (tint, hover)", (theme) => {
    expect(contrast("color.text.meta", "color.surface.tint", theme)).toBeGreaterThanOrEqual(3);
    expect(contrast("color.text.meta", "color.surface.hover", theme)).toBeGreaterThanOrEqual(3);
  });

  it.each(themes)("%s: akcent na canvas i card (pasek postępu, kropka)", (theme) => {
    expect(contrast("color.brand.accent", "color.surface.canvas", theme)).toBeGreaterThanOrEqual(3);
    expect(contrast("color.brand.accent", "color.surface.card", theme)).toBeGreaterThanOrEqual(3);
  });

  it.each(themes)("%s: fokus (color.border.focus) na canvas, card i tint", (theme) => {
    for (const bg of ["color.surface.canvas", "color.surface.card", "color.surface.tint"]) {
      expect(contrast("color.border.focus", bg, theme)).toBeGreaterThanOrEqual(3);
    }
  });

  it("fokus nie jest kolorem akcentu (accent na tint w jasnym ma 2,73:1)", () => {
    expect(contrast("color.brand.accent", "color.surface.tint", "light")).toBeLessThan(3);
    expect(raw("color-border-focus", "light")).toBe(raw("color-text-accent", "light"));
  });

  it("obrys pól nie wraca do --line-2 (color.border.default ma poniżej 3:1)", () => {
    for (const theme of themes) {
      expect(contrast("color.border.default", "color.surface.canvas", theme)).toBeLessThan(3);
    }
  });
});

describe("tokeny układu", () => {
  it("skala odstępów jest rosnąca", () => {
    const values = ["xs", "sm", "md", "lg", "xl"].map((name) => parseInt(token(`space-${name}`)));
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("margines boczny strony: 16 px, od progu komputera clamp", () => {
    expect(token("space-page-inline")).toBe("16px");
    expect(css).toMatch(
      /@media \(min-width: 48rem\)\s*{\s*:root\s*{\s*--space-page-inline:\s*clamp\(/,
    );
  });

  it("minimalny cel dotykowy to 44 px", () => {
    expect(token("size-touch-min")).toBe("44px");
  });

  it("główna akcja ekranu terenowego ma cel 48 px", () => {
    expect(token("size-touch-primary")).toBe("48px");
  });

  it("skala rozmiarów pisma jest rosnąca (rem)", () => {
    const names = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];
    const values = names.map((name) => parseFloat(token(`font-size-${name}`)));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(token("font-size-2xs")).toBe("0.625rem");
    expect(token("font-size-xs")).toBe("0.6875rem");
    expect(token("font-size-md")).toBe("1.0625rem");
    expect(token("font-size-3xl")).toBe("2.5rem");
    expect(token("font-size-4xl")).toBe("3.25rem");
  });

  it("promienie: pola 12, kafelki 16, karty 20, pełne zaokrąglenie", () => {
    expect([token("radius-sm"), token("radius-md"), token("radius-lg")]).toEqual([
      "12px",
      "16px",
      "20px",
    ]);
    expect(parseInt(token("radius-pill"))).toBeGreaterThanOrEqual(999);
  });

  it("cień karty: nocny bez cienia, jasny dwuwarstwowy", () => {
    expect(raw("shadow-card", "dark")).toBe("none");
    expect(raw("shadow-card", "light").split(/,(?![^(]*\))/)).toHaveLength(2);
  });

  it("wagi pisma: 400, 500 i 600 (bez 800)", () => {
    expect(token("font-weight-regular")).toBe("400");
    expect(token("font-weight-medium")).toBe("500");
    expect(token("font-weight-strong")).toBe("600");
  });
});

// Dolny pasek nawigacji (E3-2a, D-23): tło `glass` leży nad treścią strony. Etykieta aktywnej
// pozycji ma kolor `strong`, a nie `accent-text` (akcent wypadałby poniżej 4,5:1 nad elementem
// o przeciwnej jasności); ikona i kropka to elementy nietekstowe (≥ 3:1).
describe("pasek nawigacji (color.surface.glass)", () => {
  const underBar = ["color.surface.canvas", "color.surface.card"];
  // Najgorszy przypadek bez rozmycia: pod paskiem duży element o przeciwnej jasności.
  const opposite: Record<Theme, Rgba> = { dark: [255, 255, 255, 1], light: [0, 0, 0, 1] };

  it.each(themes)("%s: tło glass jest półprzezroczyste, tło canvas jest pełne", (theme) => {
    const [, , , alpha] = color("color.surface.glass", theme);
    expect(alpha).toBeGreaterThan(0.7);
    expect(alpha).toBeLessThan(1);
  });

  const labels = ["color.text.strong", "color.text.primary", "color.text.label"];
  const cases: [Theme, string, string][] = [];
  for (const theme of themes) {
    for (const fg of labels) for (const base of underBar) cases.push([theme, fg, base]);
  }

  it.each(cases)("%s: etykieta %s na glass nad %s ≥ 4,5:1", (theme, fg, base) => {
    expect(contrast(fg, "color.surface.glass", theme, base)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)("%s: strong i primary na glass nad elementem o przeciwnej jasności", (theme) => {
    const solid = over(color("color.surface.glass", theme), opposite[theme]);
    for (const fg of ["color.text.strong", "color.text.primary"]) {
      expect(ratio(color(fg, theme), solid)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(themes)("%s: ikona aktywnej pozycji (accent-text) i kropka (accent) ≥ 3:1", (theme) => {
    for (const base of underBar) {
      expect(
        contrast("color.text.accent", "color.surface.glass", theme, base),
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast("color.brand.accent", "color.surface.glass", theme, base),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(themes)(
    "%s: bez rozmycia pasek ma tło canvas, z etykietą strong i ikoną ≥ 3:1",
    (theme) => {
      expect(contrast("color.text.strong", "color.surface.canvas", theme)).toBeGreaterThanOrEqual(
        7,
      );
      expect(contrast("color.text.accent", "color.surface.canvas", theme)).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
});

describe("kroje", () => {
  const flat = (name: string) => token(name).replace(/\s+/g, " ");

  it("tokeny wskazują zmienne next/font z zapasem systemowym", () => {
    expect(flat("font-family-base")).toBe(
      'var(--font-geist, system-ui, -apple-system, "Segoe UI", sans-serif)',
    );
    expect(flat("font-family-display")).toBe("var(--font-instrument-serif, Georgia, serif)");
    expect(flat("font-family-mono")).toBe('var(--font-geist-mono, "Courier New", monospace)');
  });

  it("pliki krojów i licencje leżą w src/design-system/fonts", () => {
    const fontsDir = fileURLToPath(new URL("../../src/design-system/fonts/", import.meta.url));
    const files = (readdirSync(fontsDir, { recursive: true, encoding: "utf8" }) as string[]).map(
      (f) => f.replaceAll("\\", "/"),
    );
    expect(files).toEqual(
      expect.arrayContaining([
        "README.md",
        "geist/Geist-Variable.woff2",
        "geist/OFL.txt",
        "geist-mono/GeistMono-Variable.woff2",
        "geist-mono/OFL.txt",
        "instrument-serif/InstrumentSerif-Regular.woff2",
        "instrument-serif/InstrumentSerif-Italic.woff2",
        "instrument-serif/OFL.txt",
      ]),
    );
  });
});

describe("zgodność nazw tokenów", () => {
  const cssNames = [...new Set([...darkBlock.keys(), ...lightBlock.keys(), ...sharedBlock.keys()])];

  it("tokens.css definiuje dokładnie tokeny z tokens.ts", () => {
    expect([...cssNames].sort()).toEqual(tokenNames.map((name) => name.replace(/\./g, "-")).sort());
  });

  it("nie ma usuniętych tokenów (brand.primary, text.inverse, surface.elevated)", () => {
    for (const removed of ["color-brand-primary", "color-text-inverse", "color-surface-elevated"]) {
      expect(cssNames).not.toContain(removed);
    }
  });

  it("limit tokenów (D-E3-7): co najwyżej 90", () => {
    expect(tokenNames.length).toBeLessThanOrEqual(90);
  });

  it("tokenVar zwraca odwołanie do zmiennej CSS", () => {
    expect(tokenVar("color.text.accent")).toBe("var(--color-text-accent)");
  });
});

describe("ruch", () => {
  it("redukcja ruchu zeruje czas animacji w tokenach", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*:root\s*{\s*--motion-duration-short:\s*0ms;/,
    );
  });

  it("redukcja ruchu zeruje każdy --motion-duration-* (także nowe)", () => {
    const media = /@media \(prefers-reduced-motion: reduce\)\s*{\s*:root\s*{([^}]*)}/.exec(css);
    if (media === null) throw new Error("Brak bloku prefers-reduced-motion w tokens.css");
    const zeroed = declarations(media[1]);
    const durations = [...sharedBlock.keys()].filter((n) => n.startsWith("motion-duration-"));
    expect(durations.length).toBeGreaterThanOrEqual(3);
    for (const name of durations) expect(zeroed.get(name), name).toBe("0ms");
  });

  it("theme.css wyłącza animacje i przejścia jedną regułą z !important", () => {
    const theme = readFileSync(
      new URL("../../src/design-system/theme/theme.css", import.meta.url),
      "utf8",
    );
    expect(theme).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*\*,\s*\*::before,\s*\*::after\s*{[^}]*animation:\s*none\s*!important;[^}]*transition:\s*none\s*!important/,
    );
  });
});

describe("brak kolorów poza tokens.css", () => {
  const srcDir = fileURLToPath(new URL("../../src/", import.meta.url));
  // Wyjątki: stała themeColor (sprawdzana wyżej), pierścienie color-mix z tokenem oraz środek
  // gradientu karty legendarnej (`legendaryMix`, E6-4a).
  const colorFiles = new Set(["design-system/tokens/tokens.css", "app/shell/theme.ts"]);
  const files = (readdirSync(srcDir, { recursive: true, encoding: "utf8" }) as string[]).filter(
    (file) => /\.(css|tsx?)$/.test(file) && !colorFiles.has(file.replaceAll("\\", "/")),
  );
  const colorLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\(/i;
  const ringMix = /color-mix\(\s*in srgb,\s*var\(--[a-z-]+\)\s+\d+%,\s*transparent\s*\)/g;
  // Wąski wyjątek (E6-4a, D-52): środek opalizacji to mieszanka początku i końca TEJ SAMEJ
  // kategorii; odwołanie wsteczne \1 wymusza jedną kategorię, a w argumentach są wyłącznie tokeny
  // `color.legendary.*` (bez literałów koloru).
  const legendaryMix =
    /color-mix\(\s*in oklch,\s*var\(--color-legendary-([a-z-]+)-start\)(\s+\d+%)?,\s*var\(--color-legendary-\1-end\)(\s+\d+%)?\s*\)/g;
  const strip = (text: string) => text.replace(ringMix, "").replace(legendaryMix, "");

  it.each(files)("%s nie zawiera literałów koloru", (file) => {
    const text = strip(readFileSync(join(srcDir, file), "utf8"));
    expect(text).not.toMatch(colorLiteral);
  });

  it("przepuszcza środek gradientu jednej kategorii legendarnej", () => {
    for (const mix of [
      "color-mix(in oklch, var(--color-legendary-culture-night-start), var(--color-legendary-culture-night-end))",
      "color-mix(in oklch, var(--color-legendary-heritage-start) 40%, var(--color-legendary-heritage-end) 60%)",
      "color-mix(in srgb, var(--color-legendary-nature-sky-start) 40%, transparent)",
    ]) {
      expect(strip(`background: ${mix};`)).not.toMatch(colorLiteral);
    }
  });

  it.each([
    ["literał koloru", "color-mix(in oklch, #ff0000, var(--color-legendary-heritage-end))"],
    [
      "token spoza color.legendary",
      "color-mix(in oklch, var(--color-brand-accent), var(--color-legendary-heritage-end))",
    ],
    [
      "tokeny dwóch różnych kategorii",
      "color-mix(in oklch, var(--color-legendary-heritage-start), var(--color-legendary-nature-sky-end))",
    ],
    [
      "inna przestrzeń barw z literałem",
      "color-mix(in srgb, var(--color-legendary-heritage-start), red)",
    ],
    [
      "dwa tokeny tej samej kategorii w złej przestrzeni",
      "color-mix(in srgb, var(--color-legendary-heritage-start), var(--color-legendary-heritage-end))",
    ],
  ])("odrzuca color-mix: %s", (_label, mix) => {
    expect(strip(`background: ${mix};`)).toMatch(colorLiteral);
  });
});
