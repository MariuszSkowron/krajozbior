import Link from "next/link";

import type { PublishedPlaceSource } from "@/features/catalog/application/catalog-types";
import { wikidataUrl } from "@/features/catalog/domain/place-sources";

import styles from "./place-sources.module.css";

// Linia źródeł pod opisem miejsca (spec kolekcji właściciela, 5.7): podpis danych (wymóg licencji),
// odnośnik do strony „Źródła danych” z licencjami, element Wikidanych i artykuł w Wikipedii.
// Miejsce bez wpisu w źródłach nie ma tej sekcji (`source` to `null`). Poziom nagłówka zależy od
// miejsca: `h2` na stronie miejsca, `h3` w panelu miejsca (jego tytuł jest już `h2`).
export function PlaceSources({
  source,
  headingLevel = 2,
}: Readonly<{ source: PublishedPlaceSource | null; headingLevel?: 2 | 3 }>) {
  if (source === null) {
    return null;
  }

  const Heading = headingLevel === 2 ? "h2" : "h3";
  const hasLinks = source.wikipediaUrl !== null || source.wikidataQid !== null;

  return (
    <section className={styles.sources} aria-labelledby="zrodla-miejsca">
      <Heading id="zrodla-miejsca" className={styles.title}>
        Źródła
      </Heading>
      <p>
        {source.attribution}. <Link href="/zrodla">Licencje i szczegóły</Link>
      </p>
      {hasLinks ? (
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
      ) : null}
    </section>
  );
}
