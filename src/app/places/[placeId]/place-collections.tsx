import Link from "next/link";

import { CollectionProgress } from "@/design-system/components/collection-progress";
import type { PlaceCollection } from "@/features/catalog/application/catalog-types";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { formatUpdateDate } from "@/features/catalog/domain/album-view";
import { formatPlaceCount } from "@/features/catalog/domain/place-count";
import { THUMB_WIDTH } from "@/features/media/domain/limits";

import styles from "./place-collections.module.css";

/** Postęp odkrywcy w kolekcji (`null`: gość albo błąd odczytu, karta bez postępu). */
export type CollectionVisitProgress = Readonly<{ visited: number; total: number }>;

// „Kolekcje z tym miejscem” (D-57, R3): karta pozioma na całą szerokość ramy, zdjęcie okładki 1/3
// i tekst 2/3 (telefon: zdjęcie 16:9 nad tekstem). Cała karta jest jednym linkiem; nazwa kolekcji
// to nagłówek wewnątrz linku. Zdjęcie jest ozdobą (pusty tekst alternatywny): nazwa stoi obok.
// Miniatura bez podpisu (D-55 pkt 2). Teksty składają się z istniejących sformułowań.
export function PlaceCollections({
  collections,
  progress,
}: Readonly<{
  collections: readonly PlaceCollection[];
  progress: ReadonlyMap<string, CollectionVisitProgress>;
}>) {
  return (
    <ul className={styles.list}>
      {collections.map((collection) => {
        const mine = progress.get(collection.id);
        const { cover } = collection;

        return (
          <li key={collection.slug}>
            <Link className={styles.card} href={`/collections/${collection.slug}`}>
              <div className={styles.image}>
                {cover === null ? null : (
                  // eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora
                  <img
                    src={`/media/p/${cover.photoId}/w400`}
                    srcSet={
                      cover.width > THUMB_WIDTH
                        ? `/media/p/${cover.photoId}/w400 ${THUMB_WIDTH}w, /media/p/${cover.photoId}/main ${cover.width}w`
                        : undefined
                    }
                    sizes="(min-width: 48rem) 30rem, 100vw"
                    width={cover.width}
                    height={cover.height}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </div>
              <div className={styles.body}>
                <span className={styles.region}>Kolekcja · {REGION_LABELS[collection.region]}</span>
                <h3 className={styles.title}>{collection.title}</h3>
                {mine === undefined ? null : (
                  <CollectionProgress {...mine} label={`Postęp w kolekcji ${collection.title}`} />
                )}
                <p className={styles.meta}>
                  {formatPlaceCount(collection.placeCount)} · aktualizacja{" "}
                  {formatUpdateDate(collection.contentUpdatedAt)}
                  <span className={styles.arrow} aria-hidden="true">
                    →
                  </span>
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
