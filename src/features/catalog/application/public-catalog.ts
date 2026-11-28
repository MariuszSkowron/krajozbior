import { warsawToday } from "@/lib/time/warsaw-today";

import { HOME_BANNER_POOL, type HomeBannerPoolEntry } from "../domain/home-banner-pool";
import { bannerRandom, pickHomeBanner } from "../domain/home-banner";
import { MAX_COLLECTIONS_PER_LIST } from "../domain/limits";
import type { NearbyCandidate } from "../domain/nearby";
import {
  NEW_COLLECTIONS_LIMIT,
  newCollectionsSince,
  placeOfDayIndex,
} from "../domain/place-of-day";
import { isUuid } from "../domain/uuid";
import type {
  CatalogDeps,
  CollectionBanner,
  HomeBannerPick,
  NewCollection,
  PlaceOfTheDay,
  PublishedCollection,
  PublishedPlace,
  RecentCollection,
  RelatedCollection,
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
 * Collections related to a published one through common places (land <-> theme): for a land
 * the theme collections, for a theme collection the lands. Guest context, so a signed-in curator
 * gets what a guest gets. The caller reads this in its own `try/catch`: a failure must not
 * break the page.
 */
export async function listRelatedCollections(
  collection: Pick<PublishedCollection, "id" | "kind">,
  deps: CatalogDeps,
): Promise<readonly RelatedCollection[]> {
  return deps.withGuestContext((tx) =>
    deps.repository.listRelatedCollections(tx, collection.id, collection.kind),
  );
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

/** How long the place of the day is kept in the memory of the process (never past its day). */
const DEFAULT_PLACE_OF_DAY_TTL_MS = 15 * 60 * 1000;

// E2E servers set PLACE_OF_DAY_CACHE_TTL_MS=0: specs delete the places they seed, and a cached
// place would stay on the page of the next spec as a link to a page that is gone. The value is
// read ONLY in a test environment, recognised like the rest of the repository does it: the flag
// DEMO_ACCOUNTS_TEST_ONLY=1 (set by playwright.config.ts and scripts/test-env, never in production
// settings); elsewhere the TTL is always the default 15 minutes, so a stray value cannot turn the
// memory off on a real server. Even then the value is only ever lowered, never raised.
function placeOfDayTtlMs(): number {
  const raw = process.env.PLACE_OF_DAY_CACHE_TTL_MS?.trim();

  if (process.env.DEMO_ACCOUNTS_TEST_ONLY !== "1" || !raw) {
    return DEFAULT_PLACE_OF_DAY_TTL_MS;
  }

  const configured = Number(raw);

  return Number.isFinite(configured) && configured >= 0
    ? Math.min(configured, DEFAULT_PLACE_OF_DAY_TTL_MS)
    : DEFAULT_PLACE_OF_DAY_TTL_MS;
}

let placeOfDayCache: { day: string; until: number; place: PlaceOfTheDay } | null = null;

/** Forgets the place of the day kept in memory (tests start from a clean state). */
export function resetPlaceOfDayCache(): void {
  placeOfDayCache = null;
}

/**
 * The public part of "Powody do powrotu" on the home page, in one guest transaction (the same for
 * everyone):
 * - "Nowe kolekcje": at most three collections first published in the last 30 days, newest first,
 *   without the collections in `exclude` (slugs, e.g. those the explorer has saved); empty when
 *   nothing is new;
 * - "Miejsce dnia": one place drawn from the public places with a photo and a description, the
 *   same through the whole Polish calendar day, `null` when no place qualifies. The choice is kept
 *   in the memory of the process for the rest of its day, but at most 15 minutes, so a place that
 *   stops being public does not stay on the page for long; an empty result is never kept.
 * The clock is a parameter for tests.
 */
export async function getHomePublicReads(
  deps: CatalogDeps,
  exclude: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): Promise<
  Readonly<{ placeOfDay: PlaceOfTheDay | null; newCollections: readonly NewCollection[] }>
> {
  const day = warsawToday(now);
  const cached =
    placeOfDayCache !== null && placeOfDayCache.day === day && now.getTime() < placeOfDayCache.until
      ? placeOfDayCache
      : null;

  return deps.withGuestContext(async (tx) => {
    // Read as many as are left out, so the list still has three after the filter.
    const recent = await deps.repository.listCollectionsPublishedSince(
      tx,
      newCollectionsSince(now),
      NEW_COLLECTIONS_LIMIT + exclude.size,
    );
    const newCollections = recent
      .filter(({ slug }) => !exclude.has(slug))
      .slice(0, NEW_COLLECTIONS_LIMIT);

    if (cached !== null) {
      return { placeOfDay: cached.place, newCollections };
    }

    const offset = placeOfDayIndex(day, await deps.repository.countPlaceOfDayCandidates(tx));
    const placeOfDay = offset === null ? null : await deps.repository.findPlaceOfDayAt(tx, offset);

    // An empty result is not kept: it costs one cheap count, and a count and an offset that
    // differ in `read committed` would hide the place from everyone for 15 minutes.
    if (placeOfDay !== null) {
      placeOfDayCache = { day, until: now.getTime() + placeOfDayTtlMs(), place: placeOfDay };
    }

    return { placeOfDay, newCollections };
  });
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
