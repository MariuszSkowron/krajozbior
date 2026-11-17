import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { tokenNames, tokenVar } from "@/design-system/tokens/tokens";

const css = readFileSync(
  new URL("../../src/design-system/tokens/tokens.css", import.meta.url),
  "utf8",
);

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (match === null) throw new Error(`Brak tokenu --${name}`);
  return match[1].trim();
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(token(foreground)), luminance(token(background))].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

describe("tokeny kolorów (WCAG 2.x)", () => {
  const pairs: [string, string, number][] = [
    ["color-text-primary", "color-surface-canvas", 7],
    ["color-text-primary", "color-surface-card", 7],
    ["color-text-primary", "color-surface-tint", 7],
    ["color-text-secondary", "color-surface-canvas", 4.5],
    ["color-text-secondary", "color-surface-card", 4.5],
    ["color-text-secondary", "color-surface-tint", 4.5],
    ["color-text-inverse", "color-brand-primary", 4.5],
    ["color-text-inverse", "color-brand-accent", 4.5],
    ["color-brand-primary", "color-surface-canvas", 4.5],
    ["color-brand-accent", "color-surface-card", 3],
    ["color-feedback-danger", "color-surface-canvas", 4.5],
    ["color-feedback-danger", "color-surface-card", 4.5],
    ["color-border-default", "color-surface-canvas", 3],
    ["color-border-default", "color-surface-card", 3],
    ["color-border-focus", "color-surface-canvas", 3],
    ["color-border-focus", "color-surface-card", 3],
  ];

  it.each(pairs)("%s na %s ma kontrast co najmniej %d:1", (foreground, background, minimum) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});

describe("tokeny układu", () => {
  it("skala odstępów jest rosnąca", () => {
    const values = ["xs", "sm", "md", "lg", "xl"].map((name) => parseInt(token(`space-${name}`)));
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("minimalny cel dotykowy to 44 px", () => {
    expect(token("size-touch-min")).toBe("44px");
  });

  it("główna akcja ekranu terenowego ma cel 48 px", () => {
    expect(token("size-touch-primary")).toBe("48px");
  });

  it("skala rozmiarów pisma jest rosnąca (rem)", () => {
    const values = ["sm", "md", "lg", "xl", "2xl", "3xl"].map((name) =>
      parseFloat(token(`font-size-${name}`)),
    );
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(token("font-size-2xl")).toBe("2.125rem");
    expect(token("font-size-3xl")).toBe("3rem");
  });

  it("promienie v1: duża powierzchnia 16 px, pełne zaokrąglenie", () => {
    expect(token("radius-lg")).toBe("16px");
    expect(parseInt(token("radius-pill"))).toBeGreaterThanOrEqual(999);
  });

  it("cień karty ma dwie warstwy", () => {
    expect(token("shadow-card").split(/,(?![^(]*\))/)).toHaveLength(2);
  });
});

describe("krój nagłówków", () => {
  it("token display wskazuje krój z next/font, a bez niego krój systemowy", () => {
    expect(token("font-family-display").replace(/\s+/g, " ")).toMatch(
      /^var\( --font-display-face, system-ui,.* sans-serif \)$/,
    );
  });
});

describe("zgodność nazw tokenów", () => {
  const cssNames = [
    ...new Set([...css.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((match) => match[1])),
  ];

  it("tokens.css definiuje dokładnie tokeny z tokens.ts", () => {
    expect([...cssNames].sort()).toEqual(tokenNames.map((name) => name.replace(/\./g, "-")).sort());
  });

  it("tokenVar zwraca odwołanie do zmiennej CSS", () => {
    expect(tokenVar("color.brand.primary")).toBe("var(--color-brand-primary)");
  });
});

describe("ruch", () => {
  it("redukcja ruchu zeruje czas animacji w tokenach", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*:root\s*{\s*--motion-duration-short:\s*0ms;/,
    );
  });
});

describe("brak kolorów poza tokens.css", () => {
  const srcDir = fileURLToPath(new URL("../../src/", import.meta.url));
  const colorFiles = new Set(["design-system/tokens/tokens.css"]);
  const files = (readdirSync(srcDir, { recursive: true, encoding: "utf8" }) as string[]).filter(
    (file) => /\.(css|tsx?)$/.test(file) && !colorFiles.has(file.replaceAll("\\", "/")),
  );
  const colorLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\(/i;

  it.each(files)("%s nie zawiera literałów koloru", (file) => {
    expect(readFileSync(join(srcDir, file), "utf8")).not.toMatch(colorLiteral);
  });
});
