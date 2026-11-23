import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CollectionCard } from "@/design-system/components/collection-card";
import { CollectionProgress } from "@/design-system/components/collection-progress";
import { StatusBadge } from "@/design-system/components/status-badge";
import {
  LegendaryCard,
  legendaryCategories,
  type LegendaryCardCategory,
} from "@/design-system/components/legendary-card";
import {
  isSwipeUp,
  LegendaryCardReveal,
  REVEAL_DURATION_MS,
  SWIPE_UP_PX,
} from "@/design-system/components/legendary-card-reveal";
import {
  BookmarkIcon,
  CardsIcon,
  ColumnCapitalIcon,
  CompassRoseIcon,
  HomeIcon,
  LeafIcon,
  MoonStarIcon,
  PinIcon,
  ProfileIcon,
  RosetteIcon,
  SignetIcon,
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

  it("bez okładki pokazuje ozdobne pole zastępcze z pinezką, ukryte przed czytnikiem ekranu (K-38)", () => {
    const html = render(
      createElement(CollectionCard, { href: "/collections/x", title: "X", regionLabel: "Śląskie" }),
    );

    expect(html).toMatch(/<div class="[^"]*coverEmpty[^"]*" aria-hidden="true"><svg /);
    expect(html).not.toContain("<img");

    const withCover = render(
      createElement(CollectionCard, {
        href: "/collections/x",
        title: "X",
        regionLabel: "Śląskie",
        cover: { src: "/media/a", width: 400, height: 300, alt: "Most" },
      }),
    );

    expect(withCover).toContain('alt="Most"');
    expect(withCover).not.toContain("coverEmpty");
  });

  it("bez postępu nie rysuje paska ani licznika", () => {
    const html = render(
      createElement(CollectionCard, { href: "/collections/x", title: "X", regionLabel: "Śląskie" }),
    );

    expect(html).not.toContain("<progress");
    expect(html).not.toContain("odwiedzone");
  });
});

const sampleCard = {
  eventName: "Noc Muzeów",
  collectionTitle: "Wieże ciśnień Pomorza",
  placeName: "Wieża ciśnień w Tczewie",
  dateLabel: "16.05.2026, 22:40",
} as const;

const categoryLabels: Record<LegendaryCardCategory, string> = {
  culture_night: "Noc kultury",
  heritage: "Dziedzictwo",
  national_holiday: "Święto narodowe",
  nature_sky: "Przyroda i niebo",
  trail_community: "Szlak i wspólnota",
  krajozbior: "Krajozbiór",
};

describe("LegendaryCard", () => {
  it("lista kategorii to dokładnie sześć identyfikatorów z D-52", () => {
    expect([...legendaryCategories]).toEqual(Object.keys(categoryLabels));
  });

  it.each(legendaryCategories)("%s: nazwa kategorii tekstem, symbol ozdobą, data-category", (c) => {
    const html = render(createElement(LegendaryCard, { ...sampleCard, category: c }));

    expect(html).toContain(`data-category="${c}"`);
    expect(html).toContain(categoryLabels[c]);
    expect(html).toContain(">Legendarna<");
    expect(html).not.toContain("LEGENDARNA");
    expect(html).toMatch(/<svg [^>]*aria-hidden="true"/);
    expect(html).toContain("Noc Muzeów");
    expect(html).toContain("Wieże ciśnień Pomorza");
    expect(html).toContain("Wieża ciśnień w Tczewie");
    expect(html).toContain("16.05.2026, 22:40");
    expect(html).not.toContain("data-playing");
  });

  it("bez propsa category to Krajozbiór", () => {
    const html = render(createElement(LegendaryCard, sampleCard));

    expect(html).toContain('data-category="krajozbior"');
    expect(html).toContain("Krajozbiór");
  });

  it("Święto narodowe nie ma warstwy iskier ani rozbłysku pierścienia", () => {
    const html = render(
      createElement(LegendaryCard, { ...sampleCard, category: "national_holiday", playing: true }),
    );

    expect(html).not.toContain('data-layer="sparks"');
    expect(html).not.toContain('data-layer="ring"');
    expect(html).toContain('data-layer="glow"');
  });

  it("iskry (gwiazdy) ma tylko Noc kultury", () => {
    for (const c of legendaryCategories) {
      const html = render(createElement(LegendaryCard, { ...sampleCard, category: c }));
      expect(html.includes('data-layer="sparks"')).toBe(c === "culture_night");
    }
  });

  it("efekt gra tylko z propsem playing", () => {
    const html = render(createElement(LegendaryCard, { ...sampleCard, playing: true }));

    expect(html).toContain('data-playing="true"');
  });

  it("nazwa wydarzenia jest nagłówkiem o wskazanym poziomie", () => {
    const html = render(createElement(LegendaryCard, { ...sampleCard, headingLevel: 2 }));

    expect(html).toMatch(/<h2 class="[^"]*">Noc Muzeów<\/h2>/);
  });
});

describe("LegendaryCardReveal", () => {
  it("zakryta: przycisk zasłony z nazwą dostępną, pusty region aria-live, karta niedostępna", () => {
    const html = render(createElement(LegendaryCardReveal, { card: sampleCard }));

    expect(html).toContain('aria-label="Odsłoń kartę: Noc Muzeów"');
    expect(html).toMatch(/<button type="button"/);
    expect(html).toMatch(/aria-live="polite"[^>]*><\/div>/);
    expect(html).toContain("inert");
    // Twarda spacja po „w”: jednoliterowy spójnik nie zostaje na końcu wiersza.
    expect(html).toContain("Noc Muzeów: Twoja karta czeka");
    expect(html).toContain("Dotknij karty albo przesuń ją w górę");
    expect(html).toContain('data-state="sealed"');
  });

  it("scena jest zawsze nocna (klasa theme-dark na korzeniu)", () => {
    const html = render(createElement(LegendaryCardReveal, { card: sampleCard }));

    expect(html).toMatch(/^<section class="theme-dark /);
  });

  it("motion=reduce ustawia data-motion na korzeniu, auto nie", () => {
    const reduce = render(
      createElement(LegendaryCardReveal, { card: sampleCard, motion: "reduce" }),
    );
    const auto = render(createElement(LegendaryCardReveal, { card: sampleCard }));

    expect(reduce).toContain('data-motion="reduce"');
    expect(auto).not.toContain("data-motion");
  });

  it("odsłonięta od początku: bez zasłony, pusty region aria-live, miejsce w nagłówku, przyciski", () => {
    const html = render(
      createElement(LegendaryCardReveal, {
        card: sampleCard,
        initialState: "revealed",
        actions: createElement("button", { type: "button" }, "Zobacz w kolekcji"),
      }),
    );

    expect(html).not.toContain("Odsłoń kartę");
    expect(html).toMatch(/aria-live="polite"[^>]*><\/div>/);
    expect(html).toMatch(/<h2 [^>]*>Wieża ciśnień w Tczewie<\/h2>/);
    expect(html).toContain("Zobacz w kolekcji");
    expect(html).not.toContain("inert");
    expect(html).toContain('data-state="revealed"');
  });
});

// WCAG 2.2.2 i 2.3.1: żadnej pętli bez końca, najwyżej 3 cykle, łączny czas poniżej 5 s;
// efekty kategorii mają dokładnie jeden cykl i czas nie dłuższy niż motion.duration.reveal.
describe("ruch karty legendarnej (pliki CSS)", () => {
  const dir = new URL("../../src/design-system/components/", import.meta.url);
  const tokensCss = readFileSync(
    new URL("../../src/design-system/tokens/tokens.css", import.meta.url),
    "utf8",
  );
  const duration = (token: string) => {
    const match = new RegExp(`--${token}:\\s*(\\d+)ms;`).exec(tokensCss);
    if (match === null) throw new Error(`Brak tokenu --${token}`);
    return Number(match[1]);
  };
  const files = ["legendary-card.module.css", "legendary-card-reveal.module.css"];

  function animations(file: string): string[] {
    const css = readFileSync(new URL(file, dir), "utf8");
    return [...css.matchAll(/^\s*animation:\s*([^;]+);/gm)]
      .map((m) => m[1].trim())
      .filter((value) => !/^none\b/.test(value));
  }

  it.each(files)("%s: brak pętli bez końca", (file) => {
    const css = readFileSync(new URL(file, dir), "utf8");
    expect(css).not.toMatch(/infinite/);
  });

  it.each(files)("%s: czas z tokenu, najwyżej 3 cykle, łącznie poniżej 5 s", (file) => {
    const found = animations(file);
    expect(found.length).toBeGreaterThan(0);
    for (const value of found) {
      const token = /var\(--(motion-duration-[a-z]+)\)/.exec(value);
      expect(token, value).not.toBeNull();
      const withoutVars = value.replace(/var\([^)]*\)/g, "");
      const cycles = Number(/\s(\d+)\s*$/.exec(withoutVars)?.[1] ?? 1);
      expect(cycles, value).toBeLessThanOrEqual(3);
      expect(duration(token![1]) * cycles, value).toBeLessThan(5000);
    }
  });

  it("efekty kategorii: jeden cykl w motion.duration.reveal", () => {
    const found = animations("legendary-card.module.css");
    expect(found.length).toBeGreaterThanOrEqual(8);
    for (const value of found) {
      expect(value, value).toContain("var(--motion-duration-reveal)");
      expect(value, value).toMatch(/\s1$/);
    }
    expect(duration("motion-duration-reveal")).toBeLessThanOrEqual(1200);
  });

  it("tryb wysokiego kontrastu ukrywa warstwy opalizacji i efektów", () => {
    const css = readFileSync(new URL("legendary-card.module.css", dir), "utf8");
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    for (const layer of [".sheen", ".sparks", ".sweep", ".aurora", ".ring", ".glow", ".edge"]) {
      expect(forced).toContain(layer);
    }
    expect(forced).toMatch(/display:\s*none/);
    expect(forced).toContain("CanvasText");
  });
});

// WCAG 1.4.4: przy powiększonym tekście i długich nazwach karta rośnie, a nie ucina tekstu.
describe("karta legendarna: tekst nie jest przycinany (CSS)", () => {
  const dir = new URL("../../src/design-system/components/", import.meta.url);
  const css = readFileSync(new URL("legendary-card.module.css", dir), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const block = (selector: string) => {
    const match = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
    if (match === null) throw new Error(`Brak reguły ${selector}`);
    return match[1];
  };

  it("karta i twarz nie mają overflow innego niż visible", () => {
    expect(block(".card")).not.toMatch(/overflow\s*:\s*(hidden|clip|auto|scroll)/);
    expect(block(".face")).not.toMatch(/overflow\s*:\s*(hidden|clip|auto|scroll)/);
    expect(block(".face")).not.toMatch(/block-size\s*:\s*100%/);
  });

  it("karta ma minimalne proporcje 5:7 i rośnie z twarzą", () => {
    expect(block(".card")).toContain("aspect-ratio: 5 / 7");
    expect(block(".card")).toMatch(/display:\s*flex/);
    expect(block(".face")).toMatch(/flex:\s*1/);
  });

  it("przycinane są tylko kontenery warstw ozdobnych", () => {
    expect(block(".frame")).toMatch(/overflow:\s*clip/);
    expect(block(".medallion")).toMatch(/overflow:\s*clip/);
    const clipped = [...css.matchAll(/(?:^|\n)([^{}\n]+)\{[^}]*overflow:\s*(?:hidden|clip)/g)];
    for (const [, selector] of clipped) {
      expect(selector, selector).toMatch(/\.frame|\.medallion/);
    }
  });

  it("warstwy ozdobne są w kontenerach aria-hidden", () => {
    const html = render(createElement(LegendaryCard, sampleCard));

    expect(html).toMatch(/<span class="[^"]*frame[^"]*" aria-hidden="true">/);
    expect(html).toMatch(/<div class="[^"]*medallion[^"]*"[^>]* aria-hidden="true">/);
  });
});

// Przegląd UX A1–A2: medalion kategorii w pustym środku, widoczny połysk, ramka 3 px z poświatą.
describe("karta legendarna: medalion i ramka", () => {
  const dir = new URL("../../src/design-system/components/", import.meta.url);
  const css = readFileSync(new URL("legendary-card.module.css", dir), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it.each(legendaryCategories)(
    "%s: medalion z dużym symbolem i połyskiem między tytułem a miejscem",
    (c) => {
      const html = render(createElement(LegendaryCard, { ...sampleCard, category: c }));
      const medallion = /<div class="[^"]*medallion[^"]*"[^>]*>(.*?)<\/div>/.exec(html);

      expect(medallion).not.toBeNull();
      expect(medallion![1]).toMatch(/<span class="[^"]*sheen[^"]*">/);
      const svg = /<svg [^>]*>/.exec(medallion![1])?.[0] ?? "";
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toMatch(/class="[^"]*medallionSymbol/);
      expect(html.indexOf("Wieże ciśnień Pomorza")).toBeLessThan(html.indexOf("medallion"));
      expect(html.indexOf("medallion")).toBeLessThan(html.indexOf("Wieża ciśnień w Tczewie"));
    },
  );

  it("połysk leży w medalionie, nie w ramce pod twarzą", () => {
    const html = render(createElement(LegendaryCard, sampleCard));
    const frame = /<span class="[^"]*frame[^"]*" aria-hidden="true">(.*?)<\/span><div/.exec(html);

    expect(frame?.[1] ?? "").not.toContain("sheen");
  });

  it("ramka ma 3 px i stałą poświatę z tokenów kategorii, bez animacji", () => {
    const card = /(?:^|\n)\.card\s*\{([^}]*)\}/.exec(css)![1];

    expect(card).toMatch(/padding:\s*3px/);
    expect(card).toMatch(/box-shadow:[^;]*var\(--legendary-accent\)/);
    expect(card).not.toMatch(/animation/);
  });

  it("medalion: poświata i symbol z tokenów kategorii, w trybie wysokiego kontrastu bez tła", () => {
    expect(css).toMatch(/\.medallion\s*\{[^}]*radial-gradient\([^}]*var\(--legendary-accent\)/);
    expect(css).toMatch(/\.medallionSymbol\s*\{[^}]*color:\s*var\(--legendary-accent\)/);
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forced).toMatch(/\.medallion\s*\{[^}]*background:\s*none/);
    expect(forced).toMatch(/\.medallionSymbol[^}]*color:\s*CanvasText/);
  });

  it("każda kategoria ustawia --legendary-accent z własnego tokenu", () => {
    const accents = [
      ...css.matchAll(/--legendary-accent:\s*var\(--color-legendary-([a-z-]+)-(?:start|end)\)/g),
    ];
    expect(accents.map((m) => m[1]).sort()).toEqual([
      "culture-night",
      "heritage",
      "krajozbior",
      "national-holiday",
      "nature-sky",
      "trail-community",
    ]);
  });
});

// Przegląd tekstów A5–A8: skład, polskie nazwy historii, dane przykładowe.
describe("karta legendarna: teksty i dane przykładowe", () => {
  const dir = new URL("../../src/design-system/components/", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, dir), "utf8");

  it("wersaliki etykiety daje CSS, nie treść", () => {
    expect(read("legendary-card.module.css")).toMatch(
      /\n\.label\s*\{[^}]*text-transform:\s*uppercase/,
    );
  });

  it("nagłówek sceny równoważy wiersze (text-wrap: balance)", () => {
    expect(read("legendary-card-reveal.module.css")).toMatch(
      /\n\.heading\s*\{[^}]*text-wrap:\s*balance/,
    );
  });

  it("historie mają polskie nagłówki stron, bez nazw komponentów", () => {
    expect(read("legendary-card-reveal.stories.tsx")).toContain("<h1>Scena odsłonięcia karty</h1>");
    expect(read("legendary-card-reveal.stories.tsx")).not.toContain("<h1>LegendaryCardReveal");
    expect(read("legendary-card.stories.tsx")).toContain('<Page title="Karta legendarna">');
    expect(read("legendary-card.stories.tsx")).not.toContain('title="LegendaryCard"');
  });

  it("daty przykładowe bez zera przed dniem i godziną, bez cyfr w nazwie święta", () => {
    const samples = read("legendary-card.samples.ts");
    const dates = [...samples.matchAll(/dateLabel:\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(dates).toHaveLength(6);
    for (const date of dates)
      expect(date, date).toMatch(/^[1-9]\d?\.\d{1,2}\.2026, [1-9]\d?:\d{2}$/);
    expect(samples).toContain("Muzea na Święto Niepodległości");
    expect(samples).not.toContain("11 Listopada");
  });
});

describe("scena odsłonięcia: gest i czas", () => {
  const dir = new URL("../../src/design-system/components/", import.meta.url);
  const css = readFileSync(new URL("legendary-card-reveal.module.css", dir), "utf8");
  const tsx = readFileSync(new URL("legendary-card-reveal.tsx", dir), "utf8");
  const tokensCss = readFileSync(
    new URL("../../src/design-system/tokens/tokens.css", import.meta.url),
    "utf8",
  );

  const rule = (selector: string) =>
    new RegExp(`(?:^|\\n)\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

  it("zasłona przewija stronę (pan-y), a tylko uchwyt gestu ma touch-action: none", () => {
    expect(rule(".veil")).toMatch(/touch-action:\s*pan-y/);
    expect(rule(".veilRing")).toMatch(/touch-action:\s*none/);
    expect(rule(".scene")).not.toMatch(/touch-action/);
    expect([...css.matchAll(/touch-action:\s*none;/g)]).toHaveLength(1);
  });

  it("gest w górę z pointermove (bez pointercancel) przekracza próg 110 px", () => {
    // Uchwyt z touch-action: none nie dostaje pointercancel: ostatni pointermove rozstrzyga.
    const moves = [400, 380, 340, 300, 285];
    expect(isSwipeUp(moves[0], moves[moves.length - 1])).toBe(true);
    expect(isSwipeUp(moves[0], moves[1])).toBe(false);
    expect(tsx).toMatch(/onPointerMove=\{onPointerMove\}/);
    expect(tsx).toMatch(/onPointerUp=\{\(event\) => finishSwipe\(event\.clientY\)\}/);
  });

  it("przycinanie zasłony: clip-path z ujemnym marginesem na scenie karty, bez overflow na scenie", () => {
    expect(rule(".stage")).toMatch(/clip-path:\s*inset\(-1\.5rem\)/);
    expect(rule(".stage")).not.toMatch(/overflow/);
    expect(rule(".scene")).not.toMatch(/overflow/);
  });

  it("przyciski w historii „Odsłonięta” używają klas przycisków systemu", () => {
    const stories = readFileSync(new URL("legendary-card-reveal.stories.tsx", dir), "utf8");

    expect(stories).toContain("button button--primary");
    expect(stories).toContain("button button--quiet");
    expect(stories).not.toMatch(/<button type="button">/);
  });

  it("gest przechwytuje wskaźnik", () => {
    expect(tsx).toContain("setPointerCapture");
  });

  it("stała czasu odsłonięcia jest równa tokenowi motion.duration.reveal", () => {
    const token = /--motion-duration-reveal:\s*(\d+)ms;/.exec(tokensCss);
    expect(REVEAL_DURATION_MS).toBe(Number(token?.[1]));
  });

  it("próg gestu w górę", () => {
    expect(isSwipeUp(300, 300 - SWIPE_UP_PX)).toBe(true);
    expect(isSwipeUp(300, 300 - SWIPE_UP_PX + 1)).toBe(false);
    expect(isSwipeUp(300, 400)).toBe(false);
  });
});

describe("ikony", () => {
  it.each([
    HomeIcon,
    CardsIcon,
    BookmarkIcon,
    ProfileIcon,
    PinIcon,
    MoonStarIcon,
    ColumnCapitalIcon,
    RosetteIcon,
    LeafIcon,
    CompassRoseIcon,
    SignetIcon,
  ])("%o jest ozdobą ukrytą przed czytnikiem ekranu, kontur 1,7 px", (Icon) => {
    const html = render(createElement(Icon, { size: 24, className: "x" }));

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toContain('stroke-width="1.7"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('width="24"');
  });
});
