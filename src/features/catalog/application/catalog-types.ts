import type { ActionRateLimiter } from "@/features/identity/domain/action-rate-limit";
import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import type { CollectionInput, CollectionStatus, Region } from "../domain/collection";
import type { NearbyCandidate } from "../domain/nearby";
import type { AccessRestriction, PlaceInput } from "../domain/place";

// What a curator sees of a collection and a place of the own organization.
export type CollectionRow = Readonly<{
  id: string;
  slug: string;
  organizationId: string;
  title: string;
  summary: string;
  region: Region;
  status: CollectionStatus;
  firstPublishedAt: Date | null;
  version: number;
}>;

export type PlaceRow = Readonly<
  PlaceInput & { id: string; organizationId: string; version: number }
>;

// Panel read models (PR3): a list row, and an editor with the places in order.
export type CuratorCollectionSummary = Readonly<{
  id: string;
  title: string;
  region: Region;
  status: CollectionStatus;
  placeCount: number;
  updatedAt: Date;
}>;

export type CuratorPlaceItem = Readonly<PlaceRow & { position: number }>;

export type CuratorOwnPlace = Readonly<{ id: string; name: string; address: string }>;

/** A ready, visible photo of a place of the collection that may become its cover (E4-3). */
export type CoverCandidate = Readonly<{
  photoId: string;
  placeId: string;
  placeName: string;
  altText: string;
  width: number;
  height: number;
}>;

export type CuratorCollectionDetail = Readonly<{
  collection: CollectionRow;
  /** The chosen cover photo, or `null` (the card shows the placeholder, docs#39 AC2). */
  coverPlacePhotoId: string | null;
  /** Photos the curator can choose from: ready, not hidden, of places in this collection. */
  coverCandidates: readonly CoverCandidate[];
  places: readonly CuratorPlaceItem[];
  /** Places of the same organization that are not in this collection yet. */
  otherPlaces: readonly CuratorOwnPlace[];
}>;

// What a guest sees: public content only, no organization id, no version.
export type PublishedPlaceSummary = Readonly<{
  id: string;
  name: string;
  address: string;
  position: number;
  /** Public, like on the place page; the collection map puts the marker here (E12-5). */
  latitude: number;
  longitude: number;
  /** The first public photo of the place (as on the place page): a thumbnail on the card, or `null`. */
  thumb: PlaceThumb | null;
}>;

/** What a card of a place needs to show its photo: id, size and the description (public fields). */
export type PlaceThumb = Readonly<{
  photoId: string;
  width: number;
  height: number;
  altText: string;
}>;

export type PublishedCollection = Readonly<{
  id: string;
  slug: string;
  title: string;
  summary: string;
  region: Region;
  organization: Readonly<{ name: string; slug: string }>;
  places: readonly PublishedPlaceSummary[];
  /** How many places the collection has now (the same places as `places`). */
  placeCount: number;
  /**
   * The latest of: a change of the collection, a place added to it, a change of any of its
   * places. Removing a place does not move it (no trace is kept without a migration, D-E12-2).
   */
  contentUpdatedAt: Date;
  /** The cover photo with what its credit needs (E4-3), or `null` (no cover chosen). */
  cover: PlaceCover | null;
}>;

/** The cover on a card: a small photo of the collection, public fields only (E4-3). */
export type CollectionCover = Readonly<{
  photoId: string;
  width: number;
  height: number;
  altText: string;
}>;

// One card of "Kolekcje do odkrycia" on the home page: public fields only.
export type RecentCollection = Readonly<{
  id: string;
  slug: string;
  title: string;
  region: Region;
  organization: Readonly<{ name: string }>;
  placeCount: number;
  /** The cover photo (E4-3); `null` keeps the placeholder background of the card. */
  cover: CollectionCover | null;
}>;

// One place found by the public search: the first public collection (alphabetically) it lies in.
export type SearchPlaceHit = Readonly<{
  id: string;
  name: string;
  address: string;
  collection: Readonly<{ slug: string; title: string }>;
}>;

// What the repository gets of a parsed phrase (E12-2): `like` patterns on the folded texts,
// the regions named like the phrase, and the region filter of the form.
export type SearchCriteria = Readonly<{
  contains: string;
  prefix: string;
  namedRegions: readonly Region[];
  region: Region | null;
}>;

export type SearchRows = Readonly<{
  collections: readonly RecentCollection[];
  places: readonly SearchPlaceHit[];
}>;

export type PublishedPlace = Readonly<{
  id: string;
  name: string;
  description: string;
  address: string;
  accessInfo: string;
  /** E1-S11: `none` or why the grounds should not be entered (private, fenced, ruin). */
  accessRestriction: AccessRestriction;
  latitude: number;
  longitude: number;
  visitRadiusM: number;
  organization: Readonly<{ name: string; slug: string }>;
  collections: readonly Readonly<{ slug: string; title: string }>[];
  /** Only a place made from a loaded file has one (`place_sources`); other places keep `null`. */
  source: PublishedPlaceSource | null;
  /** The first public photo of the place (D-E4-7) with what its credit needs, or `null`. */
  cover: PlaceCover | null;
}>;

/** A public photo of a place, as the place page shows it: size of the file and the credit. */
export type PlaceCover = Readonly<{
  photoId: string;
  width: number;
  height: number;
  altText: string;
  title: string | null;
  authorText: string;
  authorUrl: string | null;
  sourceUrl: string | null;
  sourceKind: "own" | "third_party" | "commons_import";
  licenseCode: string;
  licenseUrl: string | null;
  licenseLabel: string;
}>;

export type PublishedPlaceSource = Readonly<{
  /** "Label (licence); …": the signature of the data the place was made from. */
  attribution: string;
  /** Article in the Polish Wikipedia, when the place has one. */
  wikipediaUrl: string | null;
  /** Element of Wikidata (`Q123`), when the place has one. */
  wikidataQid: string | null;
}>;

export type CollectionChanges = Partial<CollectionInput>;

// All database access of the catalog. Every method runs inside the context the
// use case opened (user or guest), so the row policies decide what it sees.
export interface CatalogRepository {
  /** Ids of approved organizations of which the actor is a member (full_edit). */
  permittedOrganizationIds(tx: TransactionContext): Promise<readonly string[]>;
  findEditableCollection(
    tx: TransactionContext,
    id: string,
    options?: { lock?: boolean },
  ): Promise<CollectionRow | null>;
  /** `null` when the slug is taken: the caller draws another suffix. */
  insertCollection(
    tx: TransactionContext,
    values: CollectionInput & { organizationId: string; slug: string },
  ): Promise<CollectionRow | null>;
  /** `null` when no row has this id and version (or the row is not the actor's). */
  updateCollection(
    tx: TransactionContext,
    id: string,
    version: number,
    values: CollectionInput,
  ): Promise<CollectionRow | null>;
  setCollectionStatus(
    tx: TransactionContext,
    id: string,
    version: number,
    status: CollectionStatus,
  ): Promise<CollectionRow | null>;
  /**
   * First publication of a never published collection (D-27): sets the status
   * and the address in one statement. `null` as for `updateCollection`;
   * `"slug_taken"` when the address is taken (the caller draws another suffix).
   * The transaction stays usable after `"slug_taken"`.
   */
  publishFirstTime(
    tx: TransactionContext,
    id: string,
    version: number,
    slug: string,
  ): Promise<CollectionRow | null | "slug_taken">;
  deleteCollection(tx: TransactionContext, id: string): Promise<boolean>;
  /** The cover photo id of an editable collection (`null`: none). */
  findCollectionCoverId(tx: TransactionContext, collectionId: string): Promise<string | null>;
  /** Ready, not hidden photos of the places of the collection, in the order of the places. */
  listCoverCandidates(
    tx: TransactionContext,
    collectionId: string,
  ): Promise<readonly CoverCandidate[]>;
  /**
   * Sets or clears (`null`) the cover. `"rejected"` when the database refuses the photo
   * (it is not a ready, visible photo of a place in this collection, error 23514); the
   * transaction stays usable after it. `false` when no editable collection has this id.
   */
  setCollectionCover(
    tx: TransactionContext,
    collectionId: string,
    photoId: string | null,
  ): Promise<boolean | "rejected">;
  /** Collections of one organization, newest change first, at most MAX_COLLECTIONS_PER_LIST (curator list). */
  listOrganizationCollections(
    tx: TransactionContext,
    organizationId: string,
  ): Promise<readonly CuratorCollectionSummary[]>;
  /**
   * How many collections the curator list of the organization shows. Takes a
   * transaction lock on the organization first (held to the end of the
   * transaction), so two simultaneous creations cannot both take the last place.
   */
  countOrganizationCollections(tx: TransactionContext, organizationId: string): Promise<number>;
  /** Places of a collection with their positions, in order. */
  listCollectionPlaces(
    tx: TransactionContext,
    collectionId: string,
  ): Promise<readonly CuratorPlaceItem[]>;
  /** Places of the organization that are not in the collection, at most MAX_PLACES_PER_COLLECTION (the picker of the editor). */
  listPlacesOutsideCollection(
    tx: TransactionContext,
    organizationId: string,
    collectionId: string,
  ): Promise<readonly CuratorOwnPlace[]>;
  /** Place ids of a collection in order. */
  listCollectionPlaceIds(tx: TransactionContext, collectionId: string): Promise<readonly string[]>;
  listCollectionPositions(tx: TransactionContext, collectionId: string): Promise<readonly number[]>;
  insertPlace(
    tx: TransactionContext,
    organizationId: string,
    values: PlaceInput,
  ): Promise<PlaceRow>;
  findEditablePlace(tx: TransactionContext, id: string): Promise<PlaceRow | null>;
  /** True when the place exists in the organization and the actor may edit it. */
  placeInOrganization(
    tx: TransactionContext,
    placeId: string,
    organizationId: string,
  ): Promise<boolean>;
  updatePlace(
    tx: TransactionContext,
    id: string,
    version: number,
    values: PlaceInput,
  ): Promise<PlaceRow | null>;
  /**
   * After a curator changed the description: the source row of the place (if it has one)
   * says the description was written by a person (`curator`).
   */
  markDescriptionCurated(tx: TransactionContext, placeId: string): Promise<void>;
  /** `false` when the place is already in the collection. */
  linkPlace(
    tx: TransactionContext,
    collectionId: string,
    placeId: string,
    organizationId: string,
    position: number,
  ): Promise<boolean>;
  unlinkPlace(tx: TransactionContext, collectionId: string, placeId: string): Promise<boolean>;
  reorderPlaces(
    tx: TransactionContext,
    collectionId: string,
    placeIds: readonly string[],
  ): Promise<void>;
  findPublishedCollection(
    tx: TransactionContext,
    slug: string,
  ): Promise<PublishedCollection | null>;
  findPublishedPlace(tx: TransactionContext, id: string): Promise<PublishedPlace | null>;
  /** Published collections of approved organizations, first published most recently first, at most `limit`. */
  listRecentlyPublishedCollections(
    tx: TransactionContext,
    limit: number,
  ): Promise<readonly RecentCollection[]>;
  /**
   * "W okolicy" (E12-3): published collections of approved organizations that have at least one
   * public place, with the mean of the coordinates of those places, newest first, at most `limit`.
   */
  listNearbyCandidates(tx: TransactionContext, limit: number): Promise<readonly NearbyCandidate[]>;
  /** Published collections of approved organizations by title, optionally of one region, at most `limit`. */
  listAllPublishedCollections(
    tx: TransactionContext,
    region: Region | null,
    limit: number,
  ): Promise<readonly RecentCollection[]>;
  /**
   * Public search (E12-2): at most `limit` collections and `limit` places, prefix matches
   * first. Sets a time limit for the transaction first (D-E12-10).
   */
  searchPublicCatalog(
    tx: TransactionContext,
    criteria: SearchCriteria,
    limit: number,
  ): Promise<SearchRows>;
  /** True when the error is the query being cancelled by the time limit. */
  isSearchTimeout(error: unknown): boolean;
}

export type CatalogDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  withGuestContext: <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T>;
  limiter: ActionRateLimiter;
  repository: CatalogRepository;
  /** Integer in [0, max): slug suffixes. */
  random: (max: number) => number;
}>;

// The answer of every curator use case; a handler maps it to a status code.
export type CuratorOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "rate_limited"; retryAfterSeconds: number }>
  | Readonly<{ status: "invalid"; errors: readonly string[] }>
  | Readonly<{
      status: "conflict";
      reason:
        | "stale_version"
        | "was_published"
        | "already_in_collection"
        | "too_many_places"
        | "too_many_collections"
        | "last_place_of_published_collection";
    }>
  | Readonly<{
      status: "unprocessable";
      reason: "no_places" | "already_published" | "not_published" | "cover_not_allowed";
    }>;
