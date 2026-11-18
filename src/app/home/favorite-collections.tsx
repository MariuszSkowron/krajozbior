import Link from "next/link";

import { CollectionCard } from "@/design-system/components/collection-card";
import type { SavedCollectionSummary } from "@/features/album/application/album-types";
import { HOME_FAVORITES_ON_PHONE } from "@/features/album/domain/home-album";
import { progressCounts } from "@/features/album/domain/progress";
import { REGION_LABELS } from "@/features/catalog/domain/collection";

import styles from "./home-sections.module.css";

// Ulubione kolekcje: zapisane przez odkrywcę, ostatnio używane na górze, bez osobnego
// oznaczenia „ulubiona”. Telefon pokazuje pierwsze cztery, komputer wszystkie (do sześciu).
// Stan pusty odsyła do `/search`, czyli do listy wszystkich kolekcji (E12-2).
export function FavoriteCollections({
  collections,
}: Readonly<{ collections: readonly SavedCollectionSummary[] }>) {
  return (
    <section className={styles.section} aria-labelledby="ulubione-title">
      <div className={styles.sectionHead}>
        <h2 id="ulubione-title">Ulubione kolekcje</h2>
        {collections.length === 0 ? null : (
          <Link href="/my/collections">Wszystkie moje kolekcje</Link>
        )}
      </div>
      {collections.length === 0 ? (
        <div className={styles.empty}>
          <p>Nie masz jeszcze zapisanych kolekcji. Zapisz pierwszą, a pojawi się tutaj.</p>
          <Link className="button button--primary" href="/search">
            Przeglądaj wszystkie kolekcje
          </Link>
        </div>
      ) : (
        <ul className={styles.cards}>
          {collections.map((collection, index) => (
            <li
              key={collection.id}
              className={index >= HOME_FAVORITES_ON_PHONE ? styles.phoneHidden : undefined}
            >
              <CollectionCard
                headingLevel={3}
                href={`/collections/${collection.slug}`}
                title={collection.title}
                regionLabel={REGION_LABELS[collection.region]}
                progress={progressCounts(collection.progress)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
