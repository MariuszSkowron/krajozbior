import Link from "next/link";

import { CollectionCard } from "@/design-system/components/collection-card";
import type { RecentCollection } from "@/features/catalog/application/catalog-types";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { formatPlaceCount } from "@/features/catalog/domain/place-count";

import styles from "./home-sections.module.css";

// Kolekcje do odkrycia: ostatnio opublikowane, widoczne dla każdego (także gościa).
// `collections: null` to awaria odczytu: komunikat w sekcji, reszta strony działa.
// Link „Wszystkie kolekcje” prowadzi do `/search` bez frazy (E12-2).
export function CollectionsToDiscover({
  collections,
}: Readonly<{ collections: readonly RecentCollection[] | null }>) {
  return (
    <section className={styles.section} id="do-odkrycia" aria-labelledby="odkrycie-title">
      <div className={styles.sectionHead}>
        <h2 id="odkrycie-title">Kolekcje do odkrycia</h2>
        <Link href="/search">Wszystkie kolekcje</Link>
      </div>
      {collections === null ? (
        <p role="alert" className={styles.failed}>
          Nie udało się wczytać kolekcji. Odśwież stronę.
        </p>
      ) : collections.length === 0 ? (
        <p>Nie ma jeszcze opublikowanych kolekcji. Zajrzyj tu wkrótce.</p>
      ) : (
        <ul className={styles.cards}>
          {collections.map((collection) => (
            <li key={collection.id}>
              <CollectionCard
                href={`/collections/${collection.slug}`}
                title={collection.title}
                regionLabel={REGION_LABELS[collection.region]}
              />
              <p className={styles.cardNote}>
                {formatPlaceCount(collection.placeCount)} · {collection.organization.name}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
