import Link from "next/link";

import { CollectionCard } from "@/design-system/components/collection-card";
import type { SavedCollectionSummary } from "@/features/album/application/album-types";
import { HOME_FAVORITES_ON_PHONE } from "@/features/album/domain/home-album";
import { progressCounts } from "@/features/album/domain/progress";
import type { CollectionBanner } from "@/features/catalog/application/catalog-types";
import { REGION_LABELS } from "@/features/catalog/domain/collection";

import { HomeBanner, SavedCollectionBanner } from "./home-banner";
import bannerStyles from "./home-banner.module.css";
import styles from "./home-sections.module.css";

// „Moje kolekcje” (R3, D-57): zapisane przez odkrywcę, ostatnio używane na górze. Pierwsza z nich
// to baner z okładką i postępem (cały jednym linkiem); bez zapisanej kolekcji baner pokazuje
// zdjęcie gościa i istniejący tekst stanu pustego. Pozostałe zapisane kolekcje to zwykłe karty
// (`MoreFavoriteCollections`), żeby nic nie znikało ze strony. Stan pusty odsyła do `/search`.
export function FavoriteCollections({
  collections,
  banner,
  fallbackBanner,
}: Readonly<{
  collections: readonly SavedCollectionSummary[];
  /** Okładka pierwszej zapisanej kolekcji (`null`: brak zdjęcia albo nieudany odczyt). */
  banner: CollectionBanner | null;
  /** Zdjęcie banera, gdy odkrywca nie ma zapisanej kolekcji. */
  fallbackBanner: CollectionBanner | null;
}>) {
  const [first] = collections;

  return (
    <section className={styles.section} aria-labelledby="ulubione-title">
      <div className={styles.sectionHead}>
        <h2 id="ulubione-title">Moje kolekcje</h2>
        {first === undefined ? null : <Link href="/my/collections">Wszystkie moje kolekcje</Link>}
      </div>
      {first === undefined ? (
        <HomeBanner cover={fallbackBanner} compact>
          <p className={bannerStyles.lead}>
            Nie masz jeszcze zapisanych kolekcji. Zapisz pierwszą, a pojawi się tutaj.
          </p>
          <Link className="button button--primary" href="/search">
            Przeglądaj wszystkie kolekcje
          </Link>
        </HomeBanner>
      ) : (
        <SavedCollectionBanner
          cover={banner}
          href={`/collections/${first.slug}`}
          eyebrow={`Kolekcja · ${REGION_LABELS[first.region]}`}
          title={first.title}
          progress={first.progress.kind === "progress" ? progressCounts(first.progress) : null}
        />
      )}
    </section>
  );
}

// Pozostałe zapisane kolekcje (po pierwszej, która jest banerem): karty z postępem. Telefon
// pokazuje pierwsze cztery łącznie z banerem, komputer wszystkie (do sześciu).
export function MoreFavoriteCollections({
  collections,
}: Readonly<{ collections: readonly SavedCollectionSummary[] }>) {
  const rest = collections.slice(1);

  if (rest.length === 0) {
    return null;
  }

  return (
    <ul className={styles.cards}>
      {rest.map((collection, index) => (
        <li
          key={collection.id}
          className={index + 1 >= HOME_FAVORITES_ON_PHONE ? styles.phoneHidden : undefined}
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
  );
}
