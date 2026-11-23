import Link from "next/link";
import type { ReactNode } from "react";

import { PinIcon } from "../icons/icons";
import { CollectionProgress } from "./collection-progress";
import styles from "./collection-card.module.css";

// Karta kolekcji: okładka (zdjęcie wybrane przez kuratora, E4-3) albo, gdy jej nie ma, pole
// zastępcze (jasne tło z pinezką), region wersalikami w kroju mono, nazwa szeryfem i postęp
// „9/24”. Zdjęcie ma tekst alternatywny, tło zastępcze jest ozdobą (`aria-hidden`). Cała karta
// jest jednym linkiem, więc nie ma zagnieżdżonych elementów interaktywnych; nazwa to nagłówek
// wewnątrz linku (domyślnie `h3`, poziom ustawia `headingLevel`, żeby hierarchia na ekranie nie
// przeskakiwała), żeby czytnik ekranu mógł po niej nawigować. Komponent przyjmuje proste dane:
// nie zna reguł domeny.
// Karta z odznaką lub tekstem w kolorze akcentu nie zmienia tła po najechaniu (obrys i cień).
export function CollectionCard({
  href,
  title,
  regionLabel,
  progress,
  cover,
  headingLevel = 3,
  note,
}: Readonly<{
  /** Drobna notatka pod nazwą (np. „13 miejsc · kurator”), wewnątrz karty, czyli wewnątrz linku. */
  note?: ReactNode;
  href: string;
  title: string;
  regionLabel: string;
  progress?: Readonly<{ visited: number; total: number }>;
  /** Zdjęcie okładki: adres, wymiary (rezerwują miejsce) i tekst alternatywny. */
  cover?: Readonly<{
    src: string;
    srcSet?: string;
    sizes?: string;
    /** Zdjęcie w całości (panorama, pion) zamiast przycięcia do pola okładki. */
    whole?: boolean;
    width: number;
    height: number;
    alt: string;
  }> | null;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
}>) {
  const Heading = `h${headingLevel}` as const;

  return (
    <Link className={styles.card} href={href}>
      {cover ? (
        <div className={styles.cover}>
          {/* eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora */}
          <img
            className={
              cover.whole ? `${styles.coverImage} ${styles.coverWhole}` : styles.coverImage
            }
            src={cover.src}
            srcSet={cover.srcSet}
            sizes={cover.sizes}
            width={cover.width}
            height={cover.height}
            alt={cover.alt}
            loading="lazy"
            decoding="async"
          />
        </div>
      ) : (
        <div className={`${styles.cover} ${styles.coverEmpty}`} aria-hidden="true">
          <PinIcon className={styles.coverPin} />
        </div>
      )}
      <div className={styles.body}>
        <span className={styles.region}>
          <PinIcon className={styles.pin} />
          {regionLabel}
        </span>
        <Heading className={styles.title}>{title}</Heading>
        {note === undefined ? null : <p className={styles.note}>{note}</p>}
        {progress === undefined ? null : (
          <CollectionProgress {...progress} label={`Postęp w kolekcji ${title}`} />
        )}
      </div>
    </Link>
  );
}
