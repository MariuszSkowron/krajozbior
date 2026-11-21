import Link from "next/link";

import type { PublishedPlaceSource } from "@/features/catalog/application/catalog-types";
import { wikidataUrl } from "@/features/catalog/domain/place-sources";

import styles from "./place-sources.module.css";

// Linia źródeł pod opisem miejsca (spec kolekcji właściciela, 5.7): podpis danych (wymóg licencji),
// odnośnik do strony „Źródła danych” z licencjami, element Wikidanych i artykuł w Wikipedii.
// Miejsce bez wpisu w źródłach nie ma tej sekcji (`source` to `null`).
export function PlaceSources({ source }: Readonly<{ source: PublishedPlaceSource | null }>) {
  if (source === null) {
    return null;
  }

  return (
    <section className={styles.sources} aria-labelledby="zrodla-miejsca">
      <h2 id="zrodla-miejsca" className={styles.title}>
        Źródła
      </h2>
      <p>
        {source.attribution}. <Link href="/zrodla">Licencje i szczegóły</Link>
      </p>
      <ul className={styles.links}>
        {source.wikipediaUrl === null ? null : (
          <li>
            <a href={source.wikipediaUrl} rel="noopener noreferrer">
              Więcej w Wikipedii
            </a>
          </li>
        )}
        {source.wikidataQid === null ? null : (
          <li>
            <a href={wikidataUrl(source.wikidataQid)} rel="noopener noreferrer">
              Element w Wikidanych ({source.wikidataQid})
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}
