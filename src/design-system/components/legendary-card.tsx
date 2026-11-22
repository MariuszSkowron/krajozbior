import type { ComponentType } from "react";

import {
  ColumnCapitalIcon,
  CompassRoseIcon,
  LeafIcon,
  MoonStarIcon,
  RosetteIcon,
  SignetIcon,
} from "../icons/icons";
import styles from "./legendary-card.module.css";

// Karta legendarna: nazwa wydarzenia, tytuł kolekcji, miejsce i data (kopia treści) na stałym
// tle `color.surface.card`. Opalizacja jest tylko na ramce, a każda z sześciu kategorii (D-52)
// ma własne barwy, symbol, polską nazwę i jednorazowy efekt odsłonięcia. Etykieta „LEGENDARNA”,
// nazwa kategorii i symbol mają stały kolor tekstu, więc kategorii nie rozpoznaje się po samym
// kolorze (WCAG 1.4.1), a kontrast nie zależy od kategorii. Efekt gra tylko wtedy, gdy scena
// odsłonięcia ustawi `playing`; sama karta (np. w skrytce) stoi nieruchomo w stanie końcowym.
// Komponent prezentacyjny: przyjmuje proste dane i nie zna reguł domeny.
export const legendaryCategories = [
  "culture_night",
  "heritage",
  "national_holiday",
  "nature_sky",
  "trail_community",
  "krajozbior",
] as const;

export type LegendaryCardCategory = (typeof legendaryCategories)[number];

type CategoryInfo = Readonly<{
  label: string;
  Icon: ComponentType<{ className?: string }>;
  className: string;
}>;

const categories: Readonly<Record<LegendaryCardCategory, CategoryInfo>> = {
  culture_night: { label: "Noc kultury", Icon: MoonStarIcon, className: styles.cultureNight },
  heritage: { label: "Dziedzictwo", Icon: ColumnCapitalIcon, className: styles.heritage },
  national_holiday: {
    label: "Święto narodowe",
    Icon: RosetteIcon,
    className: styles.nationalHoliday,
  },
  nature_sky: { label: "Przyroda i niebo", Icon: LeafIcon, className: styles.natureSky },
  trail_community: {
    label: "Szlak i wspólnota",
    Icon: CompassRoseIcon,
    className: styles.trailCommunity,
  },
  krajozbior: { label: "Krajozbiór", Icon: SignetIcon, className: styles.krajozbior },
};

export function legendaryCategoryLabel(category: LegendaryCardCategory): string {
  return categories[category].label;
}

export type LegendaryCardProps = Readonly<{
  eventName: string;
  collectionTitle: string;
  placeName: string;
  /** Gotowy tekst daty w czasie polskim (formatowany poza komponentem). */
  dateLabel: string;
  category?: LegendaryCardCategory;
  /** Ustawia scena odsłonięcia: gra efekt kategorii (jeden cykl). */
  playing?: boolean;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
}>;

// Warstwy efektów są ozdobą (`aria-hidden`); Święto narodowe ma tylko spokojną poświatę ramki,
// bez iskier. Warstwa `sparks` (gwiazdy) istnieje wyłącznie w Nocy kultury.
function Effect({ category }: Readonly<{ category: LegendaryCardCategory }>) {
  switch (category) {
    case "culture_night":
      return (
        <span className={styles.sparks} data-layer="sparks" aria-hidden="true">
          <span className={`${styles.star} ${styles.starA}`} />
          <span className={`${styles.star} ${styles.starB}`} />
          <span className={`${styles.star} ${styles.starC}`} />
        </span>
      );
    case "heritage":
      return <span className={styles.sweep} data-layer="sweep" aria-hidden="true" />;
    case "national_holiday":
      return null;
    case "nature_sky":
      return <span className={styles.aurora} data-layer="aurora" aria-hidden="true" />;
    case "trail_community":
      return null;
    case "krajozbior":
      return <span className={styles.ring} data-layer="ring" aria-hidden="true" />;
  }
}

export function LegendaryCard({
  eventName,
  collectionTitle,
  placeName,
  dateLabel,
  category = "krajozbior",
  playing = false,
  headingLevel = 3,
}: LegendaryCardProps) {
  const { label, Icon, className } = categories[category];
  const Heading = `h${headingLevel}` as const;

  return (
    <article
      className={`${styles.card} ${className}`}
      data-category={category}
      data-playing={playing ? "true" : undefined}
    >
      <span className={styles.sheen} aria-hidden="true" />
      {category === "trail_community" ? (
        <span className={styles.edge} data-layer="edge" aria-hidden="true" />
      ) : null}
      {category === "national_holiday" ? (
        <span className={styles.glow} data-layer="glow" aria-hidden="true" />
      ) : null}
      <div className={styles.face}>
        <Effect category={category} />
        <p className={styles.label}>LEGENDARNA</p>
        <Heading className={styles.eventName}>{eventName}</Heading>
        <p className={styles.collection}>{collectionTitle}</p>
        <p className={styles.meta}>
          <span>{placeName}</span>
          <span>{dateLabel}</span>
        </p>
        <p className={styles.category}>
          <Icon className={styles.symbol} />
          {label}
        </p>
      </div>
    </article>
  );
}
