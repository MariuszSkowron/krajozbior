import type { ReactNode } from "react";

import { CollectionComplete } from "@/design-system/components/collection-progress";
import type { PlaceCover } from "@/features/catalog/application/catalog-types";
import { showsWhole } from "@/features/catalog/domain/collection-cover";
import { THUMB_WIDTH } from "@/features/media/domain/limits";

import { PhotoCredit } from "../../places/[placeId]/photo-credit";
import styles from "./collection-cover.module.css";

// Okładka w nagłówku kolekcji (E4-3, R3 / D-57): zdjęcie na całą szerokość treści, a na nim
// etykieta, tytuł i (dla odkrywcy) postęp, przekazane jako dzieci, żeby `h1` zostało w stronie.
// Pod zdjęciem podpis (autor, licencja, źródło, informacja o zmianach, jak na stronie miejsca).
// Natywne <img> z `srcset`: miniatura `w400` dla wąskich ekranów, plik `main` dla szerokich;
// wymiary z bazy rezerwują miejsce. Zdjęcie jest przycinane stylami (`object-fit: cover`), sam
// plik się nie zmienia, więc podpis „zmniejszone i skompresowane” zostaje prawdziwy. Panoramy i
// zdjęcia pionowe (poza 4:3–16:9) pokazujemy w całości na tle zastępczym (Q4). Tekst leży na
// gradiencie przyciemniającym w kolorze `--color-text-on-image` (DT-3). Bez zdjęcia: ta sama
// okładka na tle zastępczym, tekst w kolorach motywu.
export function CollectionCover({
  cover,
  eyebrow,
  children,
}: Readonly<{ cover: PlaceCover | null; eyebrow: string; children?: ReactNode }>) {
  const text = (
    <div className={styles.text}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      {children}
    </div>
  );

  if (cover === null) {
    return <div className={`${styles.cover} ${styles.plain}`}>{text}</div>;
  }

  const main = `/media/p/${cover.photoId}/main`;
  const thumb = `/media/p/${cover.photoId}/w400`;
  const hasChoice = cover.width > THUMB_WIDTH;
  const whole = showsWhole(cover.width, cover.height);

  return (
    <figure className={styles.figure}>
      <div className={`${styles.cover} ${styles.withPhoto}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora */}
        <img
          className={whole ? styles.photoWhole : styles.photo}
          src={main}
          srcSet={hasChoice ? `${thumb} ${THUMB_WIDTH}w, ${main} ${cover.width}w` : undefined}
          sizes={hasChoice ? "(min-width: 90rem) 84rem, 100vw" : undefined}
          width={cover.width}
          height={cover.height}
          alt={cover.altText}
          decoding="async"
          fetchPriority="high"
        />
        {text}
      </div>
      <PhotoCredit photo={cover} />
    </figure>
  );
}

// Duża liczba postępu odkrywcy na okładce: „5” + „/13” + „odwiedzone” z paskiem pod spodem.
// Pasek to natywny <progress> z nazwą; tekst „5/13 odwiedzone” czyta czytnik ekranu (część
// wizualna jest przed nim ukryta), więc pasek nie jest jedynym nośnikiem. Kolekcja bez miejsc
// nie ma ani licznika, ani paska.
export function CoverProgress({
  visited,
  total,
  label,
}: Readonly<{ visited: number; total: number; label: string }>) {
  if (total === 0) {
    return null;
  }

  return (
    <div className={styles.progress}>
      <p className={styles.count}>
        <span className={styles.srOnly}>
          {visited}/{total} odwiedzone
        </span>
        <span className={styles.big} aria-hidden="true">
          {visited}
        </span>
        <span className={styles.of} aria-hidden="true">
          /{total}
        </span>
        <span className={styles.label} aria-hidden="true">
          odwiedzone
        </span>
      </p>
      <progress className={styles.bar} value={visited} max={total} aria-label={label}>
        {visited}/{total}
      </progress>
      {visited >= total ? <CollectionComplete /> : null}
    </div>
  );
}
