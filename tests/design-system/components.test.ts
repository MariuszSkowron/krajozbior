import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CollectionCard } from "@/design-system/components/collection-card";
import { CollectionProgress } from "@/design-system/components/collection-progress";
import { StatusBadge } from "@/design-system/components/status-badge";
import {
  BookmarkIcon,
  CardsIcon,
  HomeIcon,
  PinIcon,
  ProfileIcon,
} from "@/design-system/icons/icons";

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element);

describe("StatusBadge", () => {
  it.each(["success", "warning", "danger", "info", "neutral"] as const)(
    "pokazuje stan %s słowem",
    (tone) => {
      const html = render(StatusBadge({ tone, children: "Opublikowana" }));

      expect(html).toMatch(new RegExp(`^<span class="[^"]*${tone}[^"]*">Opublikowana</span>$`));
    },
  );
});

describe("CollectionProgress", () => {
  it("pokazuje pasek i licznik X/Y z nazwą dostępną", () => {
    const html = render(
      createElement(CollectionProgress, { visited: 9, total: 24, label: "Postęp w kolekcji A" }),
    );

    expect(html).toContain('<progress class="');
    expect(html).toContain('value="9" max="24" aria-label="Postęp w kolekcji A"');
    expect(html).toMatch(/<span class="[^"]*">9\/24<\/span> odwiedzone/);
  });

  it("kolekcja bez miejsc to stan 0/0 bez paska", () => {
    const html = render(
      createElement(CollectionProgress, { visited: 0, total: 0, label: "Postęp" }),
    );

    expect(html).not.toContain("<progress");
    expect(html).toMatch(/>0\/0<\/span> — ta kolekcja nie ma jeszcze miejsc/);
  });
});

describe("CollectionCard", () => {
  it("cała karta jest jednym linkiem z regionem, nazwą w nagłówku i postępem", () => {
    const html = render(
      createElement(CollectionCard, {
        href: "/collections/wieze",
        title: "Wieże ciśnień",
        regionLabel: "Pomorskie",
        progress: { visited: 1, total: 3 },
      }),
    );

    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/collections/wieze"');
    expect(html).toMatch(/<h3 class="[^"]*">Wieże ciśnień<\/h3>/);
    expect(html).toContain("Pomorskie");
    expect(html).toContain('aria-label="Postęp w kolekcji Wieże ciśnień"');
    expect(html).toContain("1/3");
  });

  it.each([2, 4, 6] as const)("poziom nagłówka %i z właściwości headingLevel", (level) => {
    const html = render(
      createElement(CollectionCard, {
        href: "/collections/x",
        title: "X",
        regionLabel: "Śląskie",
        headingLevel: level,
      }),
    );

    expect(html).toMatch(new RegExp(`<h${level} class="[^"]*">X</h${level}>`));
    expect(html).not.toContain("<h3");
  });

  it("bez postępu nie rysuje paska ani licznika", () => {
    const html = render(
      createElement(CollectionCard, { href: "/collections/x", title: "X", regionLabel: "Śląskie" }),
    );

    expect(html).not.toContain("<progress");
    expect(html).not.toContain("odwiedzone");
  });
});

describe("ikony", () => {
  it.each([HomeIcon, CardsIcon, BookmarkIcon, ProfileIcon, PinIcon])(
    "%o jest ozdobą ukrytą przed czytnikiem ekranu, kontur 1,7 px",
    (Icon) => {
      const html = render(createElement(Icon, { size: 24, className: "x" }));

      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('focusable="false"');
      expect(html).toContain('stroke-width="1.7"');
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('width="24"');
    },
  );
});
