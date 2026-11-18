import Link from "next/link";

import { PinIcon } from "../icons/icons";
import { CollectionProgress } from "./collection-progress";
import styles from "./collection-card.module.css";

// Karta kolekcji: okładka zastępcza (gradient; zdjęcia dochodzą w E4), region wersalikami
// w kroju mono, nazwa szeryfem i postęp „9/24”. Cała karta jest jednym linkiem, więc nie ma
// zagnieżdżonych elementów interaktywnych; nazwa to nagłówek `h3` wewnątrz linku, żeby czytnik
// ekranu mógł po niej nawigować. Komponent przyjmuje proste dane: nie zna reguł domeny.
// Karta z odznaką lub tekstem w kolorze akcentu nie zmienia tła po najechaniu (obrys i cień).
export function CollectionCard({
  href,
  title,
  regionLabel,
  progress,
}: Readonly<{
  href: string;
  title: string;
  regionLabel: string;
  progress?: Readonly<{ visited: number; total: number }>;
}>) {
  return (
    <Link className={styles.card} href={href}>
      <div className={styles.cover} aria-hidden="true" />
      <div className={styles.body}>
        <span className={styles.region}>
          <PinIcon className={styles.pin} />
          {regionLabel}
        </span>
        <h3 className={styles.title}>{title}</h3>
        {progress === undefined ? null : (
          <CollectionProgress {...progress} label={`Postęp w kolekcji ${title}`} />
        )}
      </div>
    </Link>
  );
}
