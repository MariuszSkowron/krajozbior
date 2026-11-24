// „Powody do powrotu” na Starcie odkrywcy: co zostało w zapisanych kolekcjach i której zaczętej
// kolekcji jeszcze nie zapisał. Czyste funkcje; o tym, co jest publiczne, rozstrzyga SQL
// repozytorium (kolekcja opublikowana, organizacja zatwierdzona), nie ten moduł.

import type { Progress } from "./progress";

/** Najwyżej tyle kolekcji w sekcji „Do odkrycia w Twoich kolekcjach”. */
export const HOME_REMAINING_COLLECTIONS = 3;
/** Najwyżej tyle nazw miejsc w jednym wierszu. */
export const HOME_REMAINING_NAMES = 2;

export type RemainingCollectionInput = Readonly<{
  id: string;
  slug: string;
  title: string;
  progress: Progress;
}>;

type OpenCollection = Omit<RemainingCollectionInput, "progress"> &
  Readonly<{ progress: Extract<Progress, { kind: "progress" }> }>;

/** Nieodwiedzone miejsce zapisanej kolekcji (nazwa publiczna), w kolejności listy kolekcji. */
export type UnvisitedPlace = Readonly<{ collectionId: string; name: string; position: number }>;

export type RemainingCollection = Readonly<{
  slug: string;
  title: string;
  remaining: number;
  /** Pierwsze nieodwiedzone miejsca w kolejności listy kolekcji. */
  names: readonly string[];
}>;

/** Kolekcje, w których coś zostało (postęp niepełny), najwyżej `HOME_REMAINING_COLLECTIONS`. */
export function incompleteCollections(
  collections: readonly RemainingCollectionInput[],
): readonly OpenCollection[] {
  return collections
    .flatMap((collection) =>
      collection.progress.kind === "progress" &&
      collection.progress.visited < collection.progress.total
        ? [{ ...collection, progress: collection.progress }]
        : [],
    )
    .slice(0, HOME_REMAINING_COLLECTIONS);
}

/** Wiersze sekcji z liczbą pozostałych miejsc i nazwami pierwszych z nich. */
export function remainingCollections(
  collections: readonly RemainingCollectionInput[],
  unvisited: readonly UnvisitedPlace[],
): readonly RemainingCollection[] {
  return incompleteCollections(collections).map(({ id, slug, title, progress }) => ({
    slug,
    title,
    remaining: progress.total - progress.visited,
    names: unvisited
      .filter((place) => place.collectionId === id)
      .sort((a, b) => a.position - b.position)
      .slice(0, HOME_REMAINING_NAMES)
      .map(({ name }) => name),
  }));
}

/** „do odkrycia: 2”: dwukropek, żeby liczba nie zmieniała czasownika (nie ma rodzaju). */
export function remainingLabel(remaining: number): string {
  return `do odkrycia: ${remaining}`;
}

/** Kolekcja z wizytą odkrywcy, której nie zapisał. */
export type StartedUnsavedCollection = Readonly<{
  id: string;
  slug: string;
  title: string;
  visited: number;
  total: number;
}>;

/** „Masz 1 z 3 miejsc kolekcji X. Zapisz ją, żeby widzieć postęp.” (po „z” zawsze „miejsc”). */
export function saveNudgeText(collection: StartedUnsavedCollection): string {
  return `Masz ${collection.visited} z ${collection.total} miejsc kolekcji ${collection.title}. Zapisz ją, żeby widzieć postęp.`;
}
