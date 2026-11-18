import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/app-shell.module.css"), "utf8");

// Ścieżki bez `backdrop-filter` nie da się sprawdzić w E2E (Chromium go obsługuje), więc
// pilnujemy jej w źródle CSS: spec 5.9 i accessibility.md („Dolny pasek”).
describe("dolny pasek bez backdrop-filter", () => {
  const block = /@supports not \(([^{]*)\)\s*\{\s*\.nav\s*\{([^}]*)\}\s*\}/.exec(css);

  it("ma regułę @supports not dla obu zapisów backdrop-filter", () => {
    expect(block, "brak reguły @supports not … { .nav { … } }").not.toBeNull();
    expect(block?.[1]).toContain("(backdrop-filter: blur(1px))");
    expect(block?.[1]).toContain("(-webkit-backdrop-filter: blur(1px))");
    expect(block?.[1]).toMatch(/\bor\b/);
  });

  it("zastępuje szkło pełnym tłem strony", () => {
    expect(block?.[2]).toMatch(/background:\s*var\(--color-surface-canvas\)/);
  });

  it("zwykła reguła paska używa szkła z rozmyciem, a @supports not stoi po niej", () => {
    const glass = css.indexOf("background: var(--color-surface-glass)");
    const fallback = css.indexOf("@supports not");

    expect(glass).toBeGreaterThan(-1);
    expect(css).toMatch(/backdrop-filter:\s*blur\(20px\)/);
    expect(fallback).toBeGreaterThan(glass);
  });
});
