import type { Region } from "../domain/collection";
import { MAX_COLLECTIONS_PER_LIST } from "../domain/limits";
import {
  SEARCH_RESULT_LIMIT,
  parseSearchPhrase,
  parseSearchRegion,
  rankSearchHits,
  regionsNamedLike,
  sortByTitle,
} from "../domain/search";
import type { CatalogDeps, RecentCollection, SearchPlaceHit } from "./catalog-types";

// The public search and the list of all collections (E12-2). Always the guest
// context (D-T4): a signed-in curator gets exactly what a guest gets, so no draft,
// withdrawn collection, collection of a suspended organization or place that lies
// only in such a collection can appear.

/** "Wszystkie kolekcje": alphabetical, at most MAX_COLLECTIONS_PER_LIST (D-25), optionally of one region. */
export async function listAllPublishedCollections(
  rawRegion: string | undefined,
  deps: CatalogDeps,
): Promise<Readonly<{ region: Region | null; collections: readonly RecentCollection[] }>> {
  const region = parseSearchRegion(rawRegion);
  const rows = await deps.withGuestContext((tx) =>
    deps.repository.listAllPublishedCollections(tx, region, MAX_COLLECTIONS_PER_LIST),
  );

  return { region, collections: sortByTitle(rows, (collection) => collection.title) };
}

export type SearchOutcome =
  | Readonly<{ status: "none"; region: Region | null }>
  // A phrase of 1 or over 80 characters never reaches the database.
  | Readonly<{ status: "invalid"; reason: "too_short" | "too_long"; region: Region | null }>
  | Readonly<{ status: "timeout" }>
  | Readonly<{
      status: "ok";
      phrase: string;
      region: Region | null;
      collections: readonly RecentCollection[];
      places: readonly SearchPlaceHit[];
      /** The query found more than SEARCH_RESULT_LIMIT of this kind. */
      moreCollections: boolean;
      morePlaces: boolean;
    }>;

/**
 * Searches collections (title, summary, region name) and places (name, address) of the
 * public catalog. `none`: no phrase, the caller shows all collections. A failure other
 * than the time limit propagates (the page shows its error screen).
 */
export async function searchPublicCatalog(
  rawPhrase: string | undefined,
  rawRegion: string | undefined,
  deps: CatalogDeps,
): Promise<SearchOutcome> {
  const region = parseSearchRegion(rawRegion);
  const phrase = parseSearchPhrase(rawPhrase);

  if (phrase.status === "none") {
    return { status: "none", region };
  }

  if (phrase.status !== "ok") {
    return { status: "invalid", reason: phrase.status, region };
  }

  try {
    const rows = await deps.withGuestContext((tx) =>
      deps.repository.searchPublicCatalog(
        tx,
        {
          contains: phrase.contains,
          prefix: phrase.prefix,
          namedRegions: regionsNamedLike(phrase.folded),
          region,
        },
        SEARCH_RESULT_LIMIT,
      ),
    );
    const moreCollections = rows.collections.length > SEARCH_RESULT_LIMIT;
    const morePlaces = rows.places.length > SEARCH_RESULT_LIMIT;

    return {
      status: "ok",
      phrase: phrase.display,
      region,
      collections: rankSearchHits(
        rows.collections,
        (collection) => collection.title,
        phrase.folded,
        SEARCH_RESULT_LIMIT,
      ),
      places: rankSearchHits(
        rows.places,
        (place) => place.name,
        phrase.folded,
        SEARCH_RESULT_LIMIT,
      ),
      moreCollections,
      morePlaces,
    };
  } catch (error) {
    if (deps.repository.isSearchTimeout(error)) {
      return { status: "timeout" };
    }

    throw error;
  }
}
