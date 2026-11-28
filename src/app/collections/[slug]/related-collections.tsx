import Link from "next/link";
import { Fragment } from "react";

import { CollectionCard } from "@/design-system/components/collection-card";
import type { RelatedCollection } from "@/features/catalog/application/catalog-types";
import { regionsLabelOf, type LandLine } from "@/features/catalog/domain/collection";
import { cardCoverImage } from "@/features/catalog/domain/collection-cover";
import { polishPlural } from "@/features/catalog/domain/place-count";

import styles from "../../catalog.module.css";
import panelStyles from "./album.module.css";

/** Postęp odkrywcy w kolekcji (brak wpisu: gość albo błąd odczytu, karta bez postępu). */
export type RelatedProgress = ReadonlyMap<string, Readonly<{ visited: number; total: number }>>;

// „3 z 9 miejsc kolekcji leży tu”: mówi, czyich miejsc dotyczy liczba. Po „z” stoi dopełniacz
// („z 9 miejsc”); czasownik zgadza się z pierwszą liczbą: „1 … leży”, „2–4 … leżą”, „5 … leży”,
// „22 … leżą”. Wszystkie miejsca albo jedyne miejsce dostają osobne, naturalne zdanie.
export function sharedPlacesNote(
  collection: Pick<RelatedCollection, "sharedPlaces" | "placeCount">,
): string {
  const { sharedPlaces, placeCount } = collection;

  if (placeCount === 1) {
    return "Jedyne miejsce kolekcji leży tu";
  }

  if (sharedPlaces === placeCount) {
    return "Wszystkie miejsca kolekcji leżą tu";
  }

  const verb = polishPlural(sharedPlaces, "leży", "leżą", "leży");

  return `${sharedPlaces} z ${placeCount} miejsc kolekcji ${verb} tu`;
}

// Linia pod opisem kolekcji tematycznej. Gdy tylko część miejsc leży w wymienionych krainach,
// mówi to wprost („1 z 2 miejsc kolekcji leży w krainie: …”), żeby nie sugerować całości.
export function landLineLabel(
  placeCount: number,
  landCount: number,
  sharedPlaces: number = placeCount,
): string {
  const lands = landCount === 1 ? "krainie" : "krainach";

  if (placeCount > 1 && sharedPlaces > 0 && sharedPlaces < placeCount) {
    const verb = polishPlural(sharedPlaces, "leży", "leżą", "leży");

    return `${sharedPlaces} z ${placeCount} miejsc kolekcji ${verb} w ${lands}: `;
  }

  return placeCount === 1
    ? `Miejsce z tej kolekcji leży w ${lands}: `
    : `Miejsca z tej kolekcji leżą w ${lands}: `;
}

// Druga warstwa, strona krainy: mniejsze kolekcje (tematyczne albo z historią), które mają
// miejsca w tej krainie. Karty jak na liście „Wszystkie kolekcje”; notatka mówi, ile miejsc
// kolekcji leży w tej krainie. Brak powiązań: komponent nie jest renderowany (bez pustej sekcji).
export function RelatedCollections({
  collections,
  progress,
}: Readonly<{ collections: readonly RelatedCollection[]; progress: RelatedProgress }>) {
  return (
    <section className={`${styles.section} ${panelStyles.related}`} aria-labelledby="tez-kolekcje">
      <h2 id="tez-kolekcje">Kolekcje w tej krainie</h2>
      <ul className={panelStyles.relatedCards}>
        {collections.map((collection) => (
          <li key={collection.id}>
            <CollectionCard
              href={`/collections/${collection.slug}`}
              title={collection.title}
              regionLabel={regionsLabelOf(collection)}
              cover={cardCoverImage(collection.cover)}
              progress={progress.get(collection.id)}
              note={sharedPlacesNote(collection)}
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
export function LandLineText({
  line,
  placeCount,
}: Readonly<{ line: LandLine; placeCount: number }>) {
  if (line.kind === "part_of") {
    return (
      <p className={panelStyles.landLine}>
        Część krainy: <Link href={`/collections/${line.land.slug}`}>{line.land.title}</Link>
      </p>
    );
  }

  return (
    <p className={panelStyles.landLine}>
      {landLineLabel(
        placeCount,
        line.lands.length,
        // Suma miejsc w krainach (krainy się nie nakładają); więcej niż miejsc kolekcji to całość.
        Math.min(
          placeCount,
          line.lands.reduce((sum, land) => sum + land.sharedPlaces, 0),
        ),
      )}
      {line.lands.map((land, index) => (
        <Fragment key={land.slug}>
          {index === 0 ? null : ", "}
          <Link href={`/collections/${land.slug}`}>{land.title}</Link>
        </Fragment>
      ))}
    </p>
  );
}
