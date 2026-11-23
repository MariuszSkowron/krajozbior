"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { LegendaryEmblem } from "./legendary-emblems";
import styles from "./legendary-card.module.css";

// Karta legendarna (D-52, D-56): ramka z opalizującego gradientu wokół stałego tła
// `color.surface.card`. Po odsłonięciu głównym elementem jest zdjęcie miejsca w oknie
// z passe-partout, nietknięte (bez filtrów, przycięcia i warstw nad nim), a pod ramką stoi
// jego podpis z autorem i licencją. Bez zdjęcia (albo gdy się nie wczyta) okno pokazuje
// emblemat kategorii. Połysk i efekty kategorii obejmują tylko ramkę, pasek górny i tablicę
// nazwy, zawsze pod oknem zdjęcia. Karta jest zawsze nocna (`theme-dark`), a podpis pod nią
// bierze motyw strony. Komponent prezentacyjny: przyjmuje proste dane i nie zna reguł domeny.
export const legendaryCategories = [
  "culture_night",
  "heritage",
  "national_holiday",
  "nature_sky",
  "trail_community",
  "krajozbior",
] as const;

export type LegendaryCardCategory = (typeof legendaryCategories)[number];

const categories: Readonly<Record<LegendaryCardCategory, { label: string; className: string }>> = {
  culture_night: { label: "Noc kultury", className: styles.cultureNight },
  heritage: { label: "Dziedzictwo", className: styles.heritage },
  national_holiday: { label: "Święto narodowe", className: styles.nationalHoliday },
  nature_sky: { label: "Przyroda i niebo", className: styles.natureSky },
  trail_community: { label: "Szlak i wspólnota", className: styles.trailCommunity },
  krajozbior: { label: "Krajozbiór", className: styles.krajozbior },
};

export function legendaryCategoryLabel(category: LegendaryCardCategory): string {
  return categories[category].label;
}

/** Zdjęcie miejsca: wymiary rezerwują miejsce w układzie. `alt` to nazwa miejsca. */
export type LegendaryCardPhoto = Readonly<{ src: string; width: number; height: number }>;

type PhotoProps =
  | Readonly<{
      photo: LegendaryCardPhoto;
      /**
       * Podpis zdjęcia (autor, licencja) w formacie ze strony miejsca; zaczyna się od rodzaju:
       * „Zdjęcie: …”. Wymagany razem ze zdjęciem; składa go ekran (warstwy design systemu).
       */
      photoCredit: ReactNode;
    }>
  | Readonly<{ photo?: undefined; photoCredit?: undefined }>;

/** Treść karty (bez stanu ruchu); `Omit` na unii zdjęcie/podpis rozbiłby ich parowanie. */
export type LegendaryCardContent = Readonly<{
  eventName: string;
  collectionTitle: string;
  placeName: string;
  /** Gotowy tekst daty w czasie polskim (formatowany poza komponentem). */
  dateLabel: string;
  category?: LegendaryCardCategory;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
}> &
  PhotoProps;

export type LegendaryCardProps = LegendaryCardContent &
  Readonly<{
    /** Ustawia scena odsłonięcia: gra efekt kategorii (jeden cykl). */
    playing?: boolean;
  }>;

// Warstwy efektów są ozdobą (`aria-hidden`) i leżą pod oknem zdjęcia; Święto narodowe ma tylko
// spokojną poświatę ramki, bez iskier. Gwiazdy (`sparks`) istnieją wyłącznie w Nocy kultury
// i zapalają się w pasku górnym.
function Effect({ category }: Readonly<{ category: LegendaryCardCategory }>) {
  switch (category) {
    case "heritage":
      return <span className={styles.sweep} data-layer="sweep" />;
    case "nature_sky":
      return <span className={styles.aurora} data-layer="aurora" />;
    default:
      return null;
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
  photo,
  photoCredit,
}: LegendaryCardProps) {
  const { label, className } = categories[category];
  const Heading = `h${headingLevel}` as const;
  const creditId = useId();
  const imageRef = useRef<HTMLImageElement>(null);
  // Zdjęcie, które się nie wczytało (zdarzenie `error`): karta wygląda wtedy jak bez zdjęcia.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = photo !== undefined && failedSrc !== photo.src;

  // Błąd mógł wystąpić, zanim React podpiął obsługę (renderowanie po stronie serwera).
  useEffect(() => {
    const image = imageRef.current;
    if (image !== null && image.complete && image.naturalWidth === 0) {
      setFailedSrc(image.getAttribute("src"));
    }
  }, [photo?.src]);

  return (
    <div className={styles.root}>
      <article
        className={`theme-dark ${styles.card} ${className}`}
        data-category={category}
        data-playing={playing ? "true" : undefined}
        data-photo={showPhoto ? "photo" : "none"}
      >
        <span className={styles.frame} aria-hidden="true">
          {category === "trail_community" ? (
            <span className={styles.edge} data-layer="edge" />
          ) : null}
          {category === "national_holiday" ? (
            <span className={styles.glow} data-layer="glow" />
          ) : null}
          {category === "krajozbior" ? <span className={styles.ring} data-layer="ring" /> : null}
        </span>
        <div className={styles.face}>
          <span className={styles.fx} aria-hidden="true">
            <span className={styles.sheen} data-layer="sheen" />
            <Effect category={category} />
          </span>
          <p className={styles.topbar}>
            <span className={styles.label}>Legendarna</span>
            {category === "culture_night" ? (
              <span className={styles.sparks} data-layer="sparks" aria-hidden="true">
                <span className={`${styles.star} ${styles.starA}`} />
                <span className={`${styles.star} ${styles.starB}`} />
                <span className={`${styles.star} ${styles.starC}`} />
              </span>
            ) : null}
            <span className={styles.category}>{label}</span>
          </p>
          <div className={styles.window} data-layer="window">
            {showPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element -- zdjęcie bez obróbki, jak PlacePhoto
              <img
                ref={imageRef}
                className={styles.photo}
                src={photo.src}
                width={photo.width}
                height={photo.height}
                alt={placeName}
                decoding="async"
                aria-describedby={creditId}
                onError={() => setFailedSrc(photo.src)}
              />
            ) : (
              <span className={styles.emblem} aria-hidden="true">
                <LegendaryEmblem category={category} />
              </span>
            )}
          </div>
          <div className={styles.plate}>
            <Heading className={styles.eventName}>{eventName}</Heading>
            <p className={styles.place}>{placeName}</p>
            <p className={styles.meta}>
              <span className={styles.date}>{dateLabel}</span>
              <span className={styles.collection}>{collectionTitle}</span>
            </p>
          </div>
        </div>
      </article>
      {showPhoto ? (
        <p id={creditId} className={styles.credit} data-part="credit">
          {photoCredit}
        </p>
      ) : null}
    </div>
  );
}
