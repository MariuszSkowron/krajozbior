import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LegalPage, legalMetadata } from "@/app/legal/legal-page";
import { LEGAL_PAGES } from "@/features/legal/domain/legal-pages";

const html = (slug: Parameters<typeof LegalPage>[0]["slug"]) =>
  renderToStaticMarkup(createElement(LegalPage, { slug }));

describe("a legal page", () => {
  it.each(LEGAL_PAGES)(
    "$slug has one h1 with the title, the draft note and the version",
    (page) => {
      const markup = html(page.slug);

      expect(markup.match(/<h1>/g)).toHaveLength(1);
      expect(markup).toContain(`<h1>${page.title}</h1>`);
      expect(markup).toContain("<strong>Wersja robocza z dnia 19 listopada 2026 r.</strong>");
      expect(markup).toContain("Tekst czeka na sprawdzenie przez prawnika.");
      expect(markup).toContain("Wersja 0.2</p>");
    },
  );

  it("lists the versions of the document: one before the first change", () => {
    const markup = html("regulamin");

    expect(markup).toMatch(
      /<section[^>]*aria-labelledby="wersje-dokumentu"[^>]*><h2 id="wersje-dokumentu">Wersje tego dokumentu<\/h2><ul><li>Wersja 0\.2 z dnia 19 listopada 2026 r\. \(obowiązująca, robocza\)<\/li><\/ul>/,
    );
  });

  it("gives a long text a table of contents with anchors to the chapters", () => {
    const markup = html("regulamin");

    expect(markup).toContain('<nav aria-label="Spis treści"');
    expect(markup).toContain('<a href="#rozdzial-1-postanowienia-ogolne">');
    expect(markup).toContain('<h2 id="rozdzial-1-postanowienia-ogolne">');
  });

  it("gives a short text no table of contents", () => {
    expect(html("zasady")).not.toContain("Spis treści");
  });

  it("keeps the headings in order: h1, then h2 (no heading level is skipped)", () => {
    for (const page of LEGAL_PAGES) {
      const levels = [...html(page.slug).matchAll(/<h([1-6])[ >]/g)].map(([, level]) =>
        Number(level),
      );

      expect(levels[0], page.slug).toBe(1);
      levels.slice(1).forEach((level, index) => {
        expect(level - levels[index]!, page.slug).toBeLessThanOrEqual(1);
      });
    }
  });

  it("puts a wide table in a named region that the keyboard can reach", () => {
    const markup = html("polityka-prywatnosci");

    expect(markup).toMatch(
      /<div class="[^"]*tableScroll[^"]*" role="region" aria-label="Tabela: 3\. Jakie dane przetwarzamy, po co i na jakiej podstawie" tabindex="0">/,
    );
    expect(markup).toContain('<th scope="col">Dane</th>');
  });

  it("links to other legal pages inside the service and to outside pages safely", () => {
    expect(html("zasady")).toContain('href="/regulamin"');
    expect(html("polityka-prywatnosci")).toContain(
      '<a href="https://uodo.gov.pl" rel="noopener noreferrer">https://uodo.gov.pl</a>',
    );
  });

  it("is kept out of search results but its links are followed (E11-Q15 A)", () => {
    for (const page of LEGAL_PAGES) {
      expect(legalMetadata(page.slug)).toEqual({
        title: `${page.title} — Krajozbiór`,
        robots: { index: false, follow: true },
      });
    }
  });
});
