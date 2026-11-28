import Link from "next/link";
import { Fragment } from "react";

import { CollectionCard } from "@/design-system/components/collection-card";
import type { RelatedCollection } from "@/features/catalog/application/catalog-types";
import { regionsLabelOf, type LandLine } from "@/features/catalog/domain/collection";
import { cardCoverImage } from "@/features/catalog/domain/collection-cover";
import { formatPlaceCount } from "@/features/catalog/domain/place-count";

import home from "../../home/home-sections.module.css";
import styles from "../../catalog.module.css";
import panelStyles from "./album.module.css";

/** Postęp odkrywcy w kolekcji (brak wpisu: gość albo błąd odczytu, karta bez postępu). */
export type RelatedProgress = ReadonlyMap<string, Readonly<{ visited: number; total: number }>>;

// Druga warstwa, strona krainy: mniejsze kolekcje (tematyczne albo z historią), które mają
// miejsca w tej krainie. Karty jak na liście „Wszystkie kolekcje”; notatka mówi, ile miejsc
// kolekcji leży w tej krainie. Brak powiązań: komponent nie jest renderowany (bez pustej sekcji).
export function RelatedCollections({
  collections,
  progress,
}: Readonly<{ collections: readonly RelatedCollection[]; progress: RelatedProgress }>) {
  return (
    <section className={styles.section} aria-labelledby="tez-kolekcje">
      <h2 id="tez-kolekcje">W tej krainie są też kolekcje</h2>
      <ul className={home.cards}>
        {collections.map((collection) => (
          <li key={collection.id}>
            <CollectionCard
              href={`/collections/${collection.slug}`}
              title={collection.title}
              regionLabel={regionsLabelOf(collection)}
              cover={cardCoverImage(collection.cover)}
              progress={progress.get(collection.id)}
              note={`${formatPlaceCount(collection.sharedPlaces)} z tej krainy`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

// Druga warstwa, strona kolekcji tematycznej: w której krainie (krainach) leżą jej miejsca.
// Przecinki rozdzielają nazwy poza linkami (nazwy krain same zawierają „i”), więc czytnik
// ekranu czyta każdą nazwę osobno.
export function LandLineText({ line }: Readonly<{ line: LandLine }>) {
  if (line.kind === "part_of") {
    return (
      <p className={panelStyles.landLine}>
        Część krainy: <Link href={`/collections/${line.land.slug}`}>{line.land.title}</Link>
      </p>
    );
  }

  return (
    <p className={panelStyles.landLine}>
      {line.lands.length === 1
        ? "Miejsca z tej kolekcji leżą w krainie: "
        : "Miejsca z tej kolekcji leżą w krainach: "}
      {line.lands.map((land, index) => (
        <Fragment key={land.slug}>
          {index === 0 ? null : ", "}
          <Link href={`/collections/${land.slug}`}>{land.title}</Link>
        </Fragment>
      ))}
    </p>
  );
}
