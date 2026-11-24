import { HOME_BANNER_POOL, type HomeBannerPoolEntry } from "../domain/home-banner-pool";
import { bannerRandom, pickHomeBanner } from "../domain/home-banner";
import { MAX_COLLECTIONS_PER_LIST } from "../domain/limits";
import type { NearbyCandidate } from "../domain/nearby";
import { isUuid } from "../domain/uuid";
import type {
  CatalogDeps,
  CollectionBanner,
  HomeBannerPick,
  PublishedCollection,
  PublishedPlace,
  RecentCollection,
} from "./catalog-types";

// Public reads for everyone, a guest included (D-T4): always in the guest
// context, so even a signed-in curator sees here exactly what a guest sees.
// A draft, a withdrawn collection, one of a suspended organization and a
// missing one all give the same `not_found`.

export type PublicReadResult<T> =
  Readonly<{ status: "ok"; value: T }> | Readonly<{ status: "not_found" }>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The cover of a published collection for the banner of the home page (guest context). */
export async function getCollectionBanner(
  slug: string,
  deps: CatalogDeps,
): Promise<CollectionBanner | null> {
  if (!SLUG.test(slug) || slug.length > 80) {
    return null;
  }

  return deps.withGuestContext((tx) => deps.repository.findCollectionBanner(tx, slug));
}

/**
 * The banner of the home page for a guest (R3, PR 4): one place drawn evenly from the pool (that
 * have a photo today), with its photo, credit and crop. `random` is injected for tests. No
 * candidate gives `null` (the page keeps the fixed photo).
 */
export async function getHomeBanner(
  deps: CatalogDeps,
  random: () => number = bannerRandom,
  pool: readonly HomeBannerPoolEntry[] = HOME_BANNER_POOL,
): Promise<HomeBannerPick | null> {
  const candidates = await deps.withGuestContext((tx) =>
    deps.repository.findHomeBannerCandidates(
      tx,
      pool.map((entry) => entry.qid),
    ),
  );
  const known = candidates.flatMap((candidate) => {
    const entry = pool.find(({ qid }) => qid === candidate.qid);

    return entry === undefined ? [] : [{ candidate, focus: entry.focus }];
  });
  const picked = pickHomeBanner(known, random);

  if (picked === null) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `qid` is only the key of the pool
  const { qid: _qid, ...banner } = picked.candidate;

  return { ...banner, focus: picked.focus };
}

export async function getPublishedCollection(
  slug: string,
  deps: CatalogDeps,
): Promise<PublicReadResult<PublishedCollection>> {
  if (!SLUG.test(slug) || slug.length > 80) {
    return { status: "not_found" };
  }

  const found = await deps.withGuestContext((tx) =>
    deps.repository.findPublishedCollection(tx, slug),
  );

  return found === null ? { status: "not_found" } : { status: "ok", value: found };
}

/**
 * "Kolekcje do odkrycia": the most recently published collections, read in the
 * guest context, so a signed-in curator gets exactly what a guest gets (no draft).
 * The limit is clamped to 1..MAX_COLLECTIONS_PER_LIST.
 */
export async function listRecentlyPublishedCollections(
  limit: number,
  deps: CatalogDeps,
): Promise<readonly RecentCollection[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_COLLECTIONS_PER_LIST);

  return deps.withGuestContext((tx) =>
    deps.repository.listRecentlyPublishedCollections(tx, bounded),
  );
}

/**
 * Public list for "W okolicy" (E12-3, D-E12-9): collections with the centre of their places, in
 * the guest context (a curator gets what a guest gets). The distance is counted in the browser;
 * the server never sees the position of the device. At most MAX_COLLECTIONS_PER_LIST (D-25).
 */
export async function listNearbyCandidates(deps: CatalogDeps): Promise<readonly NearbyCandidate[]> {
  return deps.withGuestContext((tx) =>
    deps.repository.listNearbyCandidates(tx, MAX_COLLECTIONS_PER_LIST),
  );
}

export async function getPublishedPlace(
  placeId: string,
  deps: CatalogDeps,
): Promise<PublicReadResult<PublishedPlace>> {
  if (!isUuid(placeId)) {
    return { status: "not_found" };
  }

  const found = await deps.withGuestContext((tx) =>
    deps.repository.findPublishedPlace(tx, placeId),
  );

  return found === null ? { status: "not_found" } : { status: "ok", value: found };
}
