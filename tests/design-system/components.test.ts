import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CollectionCard } from "@/design-system/components/collection-card";
import { CollectionProgress } from "@/design-system/components/collection-progress";
import { StatusBadge } from "@/design-system/components/status-badge";
import { VisitMark } from "@/design-system/components/visit-mark";
import {
  LegendaryCard,
  imageFailedToLoad,
  isPhotoShown,
  legendaryCategories,
  type LegendaryCardCategory,
} from "@/design-system/components/legendary-card";
import { LegendaryEmblem } from "@/design-system/components/legendary-emblems";
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

describe("VisitMark", () => {
  it("niesie stan słowem, w jednym znaczniku z jedną klasą koloru", () => {
    const html = render(VisitMark({ children: "Z przeszłości · 2018" }));

    expect(html).toMatch(/^<span class="[^"]*">Z przeszłości · 2018<\/span>$/);
  });
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

  it("kolekcja bez miejsc to stan „Bez miejsc” bez paska i bez 0/0", () => {
    const html = render(
      createElement(CollectionProgress, { visited: 0, total: 0, label: "Postęp" }),
    );

    expect(html).not.toContain("<progress");
    expect(html).toContain("Bez miejsc");
    expect(html).not.toContain("0/0");
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

describe("LegendaryEmblem (D-56 pkt 1)", () => {
  it.each(legendaryCategories)("%s: SVG 120×120, ozdoba, bez kolorów w znacznikach", (c) => {
    const html = render(createElement(LegendaryEmblem, { category: c }));

    expect(html).toContain(`data-emblem="${c}"`);
    expect(html).toContain('viewBox="0 0 120 120"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).not.toContain("<title");
    expect(html).not.toMatch(/(?:stroke|fill)="(?!none)[^"]+"/);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it("żadne dwa emblematy nie mają tego samego rysunku", () => {
    const drawings = legendaryCategories.map((c) =>
      render(createElement(LegendaryEmblem, { category: c })).replace(/class="[^"]*"/g, ""),
    );

    expect(new Set(drawings).size).toBe(legendaryCategories.length);
  });

  it.each(legendaryCategories)("zasłona %s pokazuje emblemat i nazwę kategorii tekstem", (c) => {
    const html = render(
      createElement(LegendaryCardReveal, { card: { ...sampleCard, category: c } }),
    );

    expect(html).toContain(`data-emblem="${c}"`);
    expect(html).toContain(categoryLabels[c]);
    expect(html).toContain(`aria-label="Odsłoń kartę: Noc Muzeów, ${categoryLabels[c]}"`);
  });
});

describe("LegendaryCardReveal", () => {
  it("zakryta: przycisk zasłony z nazwą dostępną, pusty region aria-live, karta niedostępna", () => {
    const html = render(createElement(LegendaryCardReveal, { card: sampleCard }));

    expect(html).toMatch(/aria-label="Odsłoń kartę: Noc Muzeów, [^"]+"/);
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
    expect(block(".fx")).toMatch(/overflow:\s*clip/);
    const clipped = [...css.matchAll(/(?:^|\n)([^{}\n]+)\{[^}]*overflow:\s*(?:hidden|clip)/g)];
    for (const [, selector] of clipped) {
      expect(selector, selector).toMatch(/\.frame|\.fx/);
    }
  });

  it("warstwy ozdobne są w kontenerach aria-hidden", () => {
    const html = render(createElement(LegendaryCard, sampleCard));

    expect(html).toMatch(/<span class="[^"]*frame[^"]*" aria-hidden="true">/);
    expect(html).toMatch(/<span class="[^"]*fx[^"]*" aria-hidden="true">/);
  });
});

// D-56: zdjęcie główne w oknie, bez symbolu i medalionu na karcie ze zdjęciem; połysk i efekty
// tylko wokół zdjęcia; podpis przypisany do zdjęcia; ramka 3 px z poświatą.
describe("karta legendarna: zdjęcie, okno i ramka (D-56)", () => {
  const dir = new URL("../../src/design-system/components/", import.meta.url);
  const css = readFileSync(new URL("legendary-card.module.css", dir), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const photo = { src: "/obraz.svg", width: 1200, height: 800 } as const;
  const credit = "Zdjęcie: Obraz przykładowy. Autor: Fikcyjny Autor Testowy.";
  const withPhoto = (c?: LegendaryCardCategory) =>
    render(
      createElement(LegendaryCard, {
        ...sampleCard,
        category: c,
        photo,
        photoCredit: credit,
      }),
    );
  const face = (html: string) => /<div class="[^"]*face[^"]*">(.*)<\/article>/.exec(html)![1];

  it.each(legendaryCategories)(
    "%s ze zdjęciem: zdjęcie w oknie, bez emblematu i medalionu",
    (c) => {
      const html = withPhoto(c);

      expect(html).toMatch(/<img [^>]*src="\/obraz\.svg"/);
      expect(html).not.toContain('data-layer="medallion"');
      expect(html).not.toContain("<svg");
      expect(html).not.toContain("data-emblem");
      expect(html).toContain(categoryLabels[c]);
    },
  );

  it("alt zdjęcia to nazwa miejsca, wymiary rezerwują miejsce", () => {
    const html = withPhoto();

    expect(html).toMatch(/<img [^>]*alt="Wieża ciśnień w Tczewie"/);
    expect(html).toMatch(/<img [^>]*width="1200"/);
    expect(html).toMatch(/<img [^>]*height="800"/);
  });

  it("podpis jest poza ramką karty i wskazuje go aria-describedby zdjęcia, zaczyna się od „Zdjęcie”", () => {
    const html = withPhoto();
    const describedBy = /<img [^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];

    expect(describedBy).toBeTruthy();
    const caption = new RegExp(`<div id="${describedBy}"[^>]*>([^<]*)</div>`).exec(html);
    expect(caption?.[1]).toMatch(/^Zdjęcie/);
    expect(html.indexOf("</article>")).toBeLessThan(html.indexOf(`id="${describedBy}"`));
    expect(html).not.toContain("<figure");
  });

  it("podpis z dwóch akapitów to prawidłowe zagnieżdżenie w div, aria-describedby wskazuje go", () => {
    const html = render(
      createElement(LegendaryCard, {
        ...sampleCard,
        photo,
        photoCredit: createElement(
          "figcaption",
          null,
          createElement("p", null, "Zdjęcie: Obraz."),
          createElement("p", null, "Licencja: CC."),
        ),
      }),
    );
    const describedBy = /<img [^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];

    expect(html).not.toMatch(/<p[^>]*><figcaption/);
    expect(html).toMatch(
      new RegExp(
        `<div id="${describedBy}"[^>]*><figcaption><p>Zdjęcie: Obraz\\.</p><p>Licencja: CC\\.</p></figcaption></div>`,
      ),
    );
  });

  it("zdjęcie, które się nie wczytało, daje wariant z emblematem i bez podpisu", () => {
    expect(isPhotoShown(photo, null)).toBe(true);
    expect(isPhotoShown(photo, "/inne.svg")).toBe(true);
    expect(isPhotoShown(photo, photo.src)).toBe(false);
    expect(isPhotoShown(undefined, null)).toBe(false);
    expect(imageFailedToLoad({ complete: true, naturalWidth: 0 })).toBe(true);
    expect(imageFailedToLoad({ complete: true, naturalWidth: 800 })).toBe(false);
    expect(imageFailedToLoad({ complete: false, naturalWidth: 0 })).toBe(false);
  });

  it("srcSet i sizes trafiają do img", () => {
    const html = render(
      createElement(LegendaryCard, {
        ...sampleCard,
        photo: { ...photo, srcSet: "/m.svg 400w, /d.svg 1200w", sizes: "18rem" },
        photoCredit: credit,
      }),
    );

    expect(html).toMatch(/<img [^>]*srcSet="\/m\.svg 400w, \/d\.svg 1200w"/);
    expect(html).toMatch(/<img [^>]*sizes="18rem"/);
  });

  it("bez zdjęcia: emblemat kategorii w oknie, bez img i bez podpisu", () => {
    const html = render(createElement(LegendaryCard, { ...sampleCard, category: "heritage" }));

    expect(html).toContain('data-emblem="heritage"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("aria-describedby");
    expect(html).toContain('data-photo="none"');
  });

  it("karta jest zawsze nocna (theme-dark na korzeniu karty)", () => {
    expect(withPhoto()).toMatch(/<article class="theme-dark /);
  });

  it("warstwy połysku i efektów nie są potomkami okna zdjęcia", () => {
    for (const c of legendaryCategories) {
      const html = withPhoto(c);
      const start = html.indexOf('data-layer="window"');
      const end = html.indexOf('data-layer="window"') + html.slice(start).indexOf("</div>");
      const windowHtml = html.slice(start, end);

      for (const layer of ["sheen", "sweep", "aurora", "sparks", "edge", "glow", "ring"]) {
        expect(windowHtml, `${c}: ${layer}`).not.toContain(`data-layer="${layer}"`);
      }
      expect(html).toContain('data-layer="sheen"');
    }
    expect(face(withPhoto())).toContain('data-layer="window"');
  });

  it("CSS: zdjęcie i okno bez filtrów, mieszania, półprzezroczystości, przycięcia i maski", () => {
    const forbidden =
      /(?:^|[;\s])(filter|mix-blend-mode|clip-path|mask|mask-image)\s*:|opacity\s*:\s*(?!1\b)/;
    for (const selector of [
      ".photo",
      ".window",
      '.card[data-photo="none"] .window',
      ".face",
      ".card",
    ]) {
      const body = css.match(
        new RegExp(
          `(?:^|\\n)${selector.replace(/[\\^$.*+?()[\]{}|"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
        ),
      )?.[1];
      expect(body, selector).toBeDefined();
      expect(body, selector).not.toMatch(forbidden);
    }
    expect(css).toMatch(/\.photo\s*\{[^}]*object-fit:\s*contain/);
    expect(css).not.toMatch(/\.photo\s*\{[^}]*(?:border-radius|object-fit:\s*cover)/);
  });

  it("CSS: żadna animacja nie dotyczy zdjęcia ani okna", () => {
    const targets = [...css.matchAll(/([^{}]+)\{[^}]*animation:[^}]*\}/g)].map((m) => m[1]);

    expect(targets.length).toBeGreaterThan(0);
    for (const selector of targets) {
      expect(selector, selector).not.toMatch(/\.photo|\.window|\.emblem|\.face\b|\.credit/);
    }
  });

  it("CSS: okno rośnie z kartą i ma minimum 10 rem; zdjęcie ma margines passe-partout", () => {
    expect(css).toMatch(/\.window\s*\{[^}]*flex:\s*1 1 auto[^}]*min-block-size:\s*10rem/);
    expect(css).toMatch(/\.photo\s*\{[^}]*inset:\s*var\(--space-sm\)/);
    expect(css).toMatch(
      /\.photo\s*\{[^}]*max-inline-size:\s*calc\(100% - 2 \* var\(--space-sm\)\)/,
    );
  });

  it("CSS: wysoki kontrast — CanvasText, tło okna Canvas, linki LinkText, efekty ukryte", () => {
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));

    expect(forced).toMatch(/\.window[^{]*\{[^}]*background:\s*Canvas/);
    expect(forced).toMatch(/\.photo\s*\{[^}]*border-color:\s*CanvasText/);
    expect(forced).toMatch(/\.credit a\s*\{[^}]*color:\s*LinkText/);
    expect(forced).toContain(".fx");
  });

  it("ramka ma 3 px i stałą poświatę z tokenów kategorii, bez animacji", () => {
    const card = /(?:^|\n)\.card\s*\{([^}]*)\}/.exec(css)![1];

    expect(card).toMatch(/padding:\s*3px/);
    expect(card).toMatch(/box-shadow:[^;]*var\(--legendary-accent\)/);
    expect(card).not.toMatch(/animation/);
  });

  it("passe-partout: poświata z tokenu kategorii na stałym tle karty, bez medalionu", () => {
    expect(css).toMatch(/\.window\s*\{[^}]*radial-gradient\([^}]*var\(--legendary-accent\)/);
    expect(css).not.toMatch(/medallion/);
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
      /\n\.topbar\s*\{[^}]*text-transform:\s*uppercase/,
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
    expect(rule(".veilEmblem")).toMatch(/touch-action:\s*none/);
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
