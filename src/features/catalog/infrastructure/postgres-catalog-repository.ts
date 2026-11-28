import "server-only";

import {
  collectionCoverLateral,
  coverCardColumns,
  coverCreditColumns,
  toCardCover,
} from "./collection-cover-sql";
import { placeInPublicCollection, publishedCollection } from "./public-visibility";
import type { TransactionContext } from "@/lib/db/user-context";

import type {
  CatalogRepository,
  CollectionRow,
  CoverCandidate,
  CuratorCollectionSummary,
  CuratorOwnPlace,
  CuratorPlaceItem,
  PlaceRow,
  CollectionBanner,
  HomeBannerCandidate,
  PublishedCollection,
  PlaceCollection,
  PublishedPlace,
  RecentCollection,
  SearchPlaceHit,
} from "../application/catalog-types";
import type { CollectionStatus, Region } from "../domain/collection";
import {
  MAX_COLLECTIONS_PER_LIST,
  MAX_COVER_CANDIDATES,
  MAX_PLACES_PER_COLLECTION,
} from "../domain/limits";
import { SEARCH_TIME_BUDGET_MS, foldSql, remainingBudgetMs } from "../domain/search";

// Raw SQL on the transaction of the use case (user or guest context), so the
// row policies decide what each statement sees or changes. No statement names
// a user id: the owner of a write is the organization checked by the policies.
// Coordinates are bound parameters of a curator's own place, never a log field.

const collectionColumns = `c.id, c.slug, c.organization_id as "organizationId", c.title,
  c.summary, c.region, c.status, c.first_published_at as "firstPublishedAt", c.version`;
const returningCollection = `id, slug, organization_id as "organizationId", title,
  summary, region, status, first_published_at as "firstPublishedAt", version`;
const placeColumns = `id, organization_id as "organizationId", name, description, address,
  access_info as "accessInfo", access_restriction as "accessRestriction", latitude, longitude,
  visit_radius_m as "visitRadiusM", version`;

const first = <T>(rows: readonly T[]): T | null => rows[0] ?? null;

const SLUG_CONSTRAINT = "collections_slug_key";

// PostgreSQL error 23505 on the address index only (the driver error may be
// wrapped); another unique violation is a real failure, not a taken address.
export function isSlugTaken(error: unknown): boolean {
  const { code, constraint, cause } = (error ?? {}) as {
    code?: unknown;
    constraint?: unknown;
    cause?: unknown;
  };

  return (
    (code === "23505" && constraint === SLUG_CONSTRAINT) ||
    (cause !== undefined && isSlugTaken(cause))
  );
}

// The cover guard (23514 on the trigger `collections_cover_guard`): the photo is not a ready,
// visible photo of a place in the collection. Foreign keys give 23503 for a photo that does not
// exist, which is the same answer for the curator (the photo cannot be a cover).
export function isCoverRejected(error: unknown): boolean {
  const { code, constraint, cause } = (error ?? {}) as {
    code?: unknown;
    constraint?: unknown;
    cause?: unknown;
  };

  return (
    (code === "23514" && constraint === "collections_cover_guard") ||
    code === "23503" ||
    (cause !== undefined && isCoverRejected(cause))
  );
}

// PostgreSQL error 57014: the statement was cancelled (the time limit of the search).
export function isQueryCancelled(error: unknown): boolean {
  const { code, cause } = (error ?? {}) as { code?: unknown; cause?: unknown };

  return code === "57014" || (cause !== undefined && isQueryCancelled(cause));
}

type CollectionCardRow = {
  id: string;
  slug: string;
  title: string;
  region: Region;
  organizationName: string;
  placeCount: number;
  coverPhotoId: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  coverAltText: string | null;
};

const toRecentCollection = ({
  organizationName,
  coverPhotoId,
  coverWidth,
  coverHeight,
  coverAltText,
  ...rest
}: CollectionCardRow): RecentCollection => ({
  ...rest,
  organization: { name: organizationName },
  cover: toCardCover({ coverPhotoId, coverWidth, coverHeight, coverAltText }),
});

// The columns of a collection card (public fields only); the collection is `c`, its organization
// `o`, its cover photo `cph` (see `collectionCardJoin`). A card shows the id, size and description
// of the cover photo, never the author or any column the application role cannot read.
const collectionCardColumns = `c.id, c.slug, c.title, c.region, o.name as "organizationName",
  (select count(*)::int from public.collection_places cp
    where cp.collection_id = c.id) as "placeCount",
  ${coverCardColumns("cph")}`;

// The cover lateral lives in `collection-cover-sql.ts` (shared with the news).
const collectionCardJoin = collectionCoverLateral("cph");

// Kandydat na „Miejsce dnia” (miejsce `p`): opis, gotowe zdjęcie, zatwierdzona organizacja i
// opublikowana kolekcja. Licznik i wybór używają tego samego warunku, więc numer zawsze trafia.
// Ukryte zdjęcie (`hidden_at`) odcina polityka `place_photos_select` w kontekście gościa; warunku
// nie da się tu wypisać, bo rola aplikacji nie ma uprawnienia do odczytu kolumn `hidden_*`
// (`Migration20261121170000_place_photos`). Pilnuje tego test integracyjny z ukrytym zdjęciem.
const placeOfDayCandidate = `
  p.description <> ''
  and p.access_restriction = 'none'
  and exists (select from public.organizations po where po.id = p.organization_id and po.status = 'approved')
  and exists (select from public.place_photos x
               where x.place_id = p.id and x.file_state = 'ready' and x.storage_key is not null)
  and exists (select from public.collection_places cp
                join public.collections c on c.id = cp.collection_id
                join public.organizations co on co.id = c.organization_id
               where cp.place_id = p.id and c.status = 'published' and co.status = 'approved')`;

const LIKE = `like ? escape '\\'`;

export const postgresCatalogRepository: CatalogRepository = {
  async permittedOrganizationIds(tx) {
    const rows = await tx.em.execute<{ id: string }[]>(
      `select o.id
         from public.organizations o
        where app_org_permission(o.id) = 'full_edit'
        order by o.name, o.id`,
    );

    return rows.map((row) => row.id);
  },

  async findEditableCollection(tx, id, options) {
    return first(
      await tx.em.execute<CollectionRow[]>(
        `select ${collectionColumns}
           from public.collections c
          where c.id = ? and app_org_permission(c.organization_id) = 'full_edit'
          ${options?.lock === true ? "for update" : ""}`,
        [id],
      ),
    );
  },

  async insertCollection(tx, values) {
    return first(
      await tx.em.execute<CollectionRow[]>(
        `insert into public.collections (slug, organization_id, title, summary, region, status)
         values (?, ?, ?, ?, ?, 'draft')
         on conflict (slug) do nothing
         returning ${returningCollection}`,
        [values.slug, values.organizationId, values.title, values.summary, values.region],
      ),
    );
  },

  async updateCollection(tx, id, version, values) {
    return first(
      await tx.em.execute<CollectionRow[]>(
        `update public.collections
            set title = ?, summary = ?, region = ?, version = version + 1, updated_at = now()
          where id = ? and version = ?
          returning ${returningCollection}`,
        [values.title, values.summary, values.region, id, version],
      ),
    );
  },

  async setCollectionStatus(tx, id, version, status: CollectionStatus) {
    return first(
      await tx.em.execute<CollectionRow[]>(
        `update public.collections
            set status = ?, version = version + 1, updated_at = now()
          where id = ? and version = ?
          returning ${returningCollection}`,
        [status, id, version],
      ),
    );
  },

  async publishFirstTime(tx, id, version, slug) {
    // A collision with a draft of another organization is invisible to the
    // policies, so the unique index reports it. A savepoint keeps the rest of
    // the transaction usable, and the caller draws another suffix.
    await tx.em.execute(`savepoint first_publication_slug`);

    try {
      const row = first(
        await tx.em.execute<CollectionRow[]>(
          `update public.collections
              set status = 'published', slug = ?, version = version + 1, updated_at = now()
            where id = ? and version = ?
            returning ${returningCollection}`,
          [slug, id, version],
        ),
      );

      await tx.em.execute(`release savepoint first_publication_slug`);

      return row;
    } catch (error) {
      if (isSlugTaken(error)) {
        await tx.em.execute(`rollback to savepoint first_publication_slug`);

        return "slug_taken";
      }

      throw error;
    }
  },

  async deleteCollection(tx, id) {
    const rows = await tx.em.execute<{ id: string }[]>(
      `delete from public.collections where id = ? returning id`,
      [id],
    );

    return rows.length > 0;
  },

  async findCollectionCoverId(tx, collectionId) {
    const rows = await tx.em.execute<{ coverId: string | null }[]>(
      `select c.cover_place_photo_id as "coverId"
         from public.collections c
        where c.id = ? and app_org_permission(c.organization_id) = 'full_edit'`,
      [collectionId],
    );

    return rows[0]?.coverId ?? null;
  },

  async listCoverCandidates(tx, collectionId) {
    // The photos are read as the curator (policy of `place_photos`: own organization), so a
    // hidden photo (no grant on `hidden_at`) is dropped by the trigger on choice, not here; the
    // list shows ready photos only and the guard has the last word.
    return tx.em.execute<CoverCandidate[]>(
      `select ph.id as "photoId", p.id as "placeId", p.name as "placeName",
              ph.alt_text as "altText", ph.width, ph.height
         from public.collection_places cp
         join public.places p on p.id = cp.place_id
         join public.place_photos ph on ph.place_id = p.id
        where cp.collection_id = ? and ph.file_state = 'ready' and ph.storage_key is not null
        order by cp.position, ph.position
        limit ?`,
      [collectionId, MAX_COVER_CANDIDATES],
    );
  },

  async findPublicAutoCoverPhotoId(tx, collectionId) {
    // Guest context: the policy of `place_photos` leaves only photos everybody may see.
    const rows = await tx.em.execute<{ id: string }[]>(
      `select ph.id
         from public.collection_places cp
         cross join lateral (
           select p.id, p.position
             from public.place_photos p
            where p.place_id = cp.place_id and p.file_state = 'ready' and p.storage_key is not null
            order by p.position
            limit 1
         ) ph
        where cp.collection_id = ?
        order by cp.position
        limit 1`,
      [collectionId],
    );

    return rows[0]?.id ?? null;
  },

  async setCollectionCover(tx, collectionId, photoId) {
    // A savepoint keeps the transaction usable when the guard refuses the photo (23514).
    await tx.em.execute(`savepoint collection_cover`);

    try {
      const rows = await tx.em.execute<{ id: string }[]>(
        `update public.collections
            set cover_place_photo_id = ?, updated_at = now()
          where id = ? and app_org_permission(organization_id) = 'full_edit'
          returning id`,
        [photoId, collectionId],
      );

      await tx.em.execute(`release savepoint collection_cover`);

      return rows.length > 0;
    } catch (error) {
      if (isCoverRejected(error)) {
        await tx.em.execute(`rollback to savepoint collection_cover`);

        return "rejected";
      }

      throw error;
    }
  },

  async listOrganizationCollections(tx, organizationId) {
    // The driver returns timestamptz as text here.
    const rows = await tx.em.execute<
      (Omit<CuratorCollectionSummary, "updatedAt"> & { updatedAt: string | Date })[]
    >(
      // The numbers of saves come from one call of the aggregate function (never rows of
      // `saved_collections`): it answers only for the organization of the member (private data).
      `with saves as (select s.collection_id, s.saves from public.app_collection_saves(?) s)
       select c.id, c.title, c.region, c.status,
              (select count(*)::int from public.collection_places cp where cp.collection_id = c.id)
                as "placeCount",
              coalesce(sv.saves, 0)::int as "saveCount",
              to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "updatedAt"
         from public.collections c
         left join saves sv on sv.collection_id = c.id
        where c.organization_id = ? and app_org_permission(c.organization_id) = 'full_edit'
        order by c.updated_at desc, c.id
        limit ?`,
      [organizationId, organizationId, MAX_COLLECTIONS_PER_LIST],
    );

    return rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) }));
  },

  async countOrganizationCollections(tx, organizationId) {
    // The lock is a statement of its own: the count below then takes its
    // snapshot after the lock is held, so it sees every creation that finished.
    await tx.em.execute(`select pg_advisory_xact_lock(hashtextextended(?::text, 0))`, [
      `organization_collections:${organizationId}`,
    ]);

    const rows = await tx.em.execute<{ total: number }[]>(
      `select count(*)::int as total
         from public.collections c
        where c.organization_id = ? and app_org_permission(c.organization_id) = 'full_edit'`,
      [organizationId],
    );

    return rows[0]?.total ?? 0;
  },

  async listCollectionPlaces(tx, collectionId) {
    return tx.em.execute<CuratorPlaceItem[]>(
      `select p.id, p.organization_id as "organizationId", p.name, p.description, p.address,
              p.access_info as "accessInfo", p.access_restriction as "accessRestriction",
              p.latitude, p.longitude,
              p.visit_radius_m as "visitRadiusM", p.version, cp.position
         from public.collection_places cp
         join public.places p on p.id = cp.place_id
        where cp.collection_id = ? and app_org_permission(p.organization_id) = 'full_edit'
        order by cp.position`,
      [collectionId],
    );
  },

  async listPlacesOutsideCollection(tx, organizationId, collectionId) {
    return tx.em.execute<CuratorOwnPlace[]>(
      `select p.id, p.name, p.address
         from public.places p
        where p.organization_id = ? and app_org_permission(p.organization_id) = 'full_edit'
          and not exists (
            select from public.collection_places cp
             where cp.collection_id = ? and cp.place_id = p.id
          )
        order by p.name, p.id
        limit ?`,
      [organizationId, collectionId, MAX_PLACES_PER_COLLECTION],
    );
  },

  async listCollectionPlaceIds(tx, collectionId) {
    const rows = await tx.em.execute<{ placeId: string }[]>(
      `select place_id as "placeId"
         from public.collection_places
        where collection_id = ?
        order by position`,
      [collectionId],
    );

    return rows.map((row) => row.placeId);
  },

  async listCollectionPositions(tx, collectionId) {
    const rows = await tx.em.execute<{ position: number }[]>(
      `select position from public.collection_places where collection_id = ?`,
      [collectionId],
    );

    return rows.map((row) => row.position);
  },

  async insertPlace(tx, organizationId, values) {
    const rows = await tx.em.execute<PlaceRow[]>(
      `insert into public.places
         (organization_id, name, description, address, access_info, access_restriction,
          latitude, longitude, visit_radius_m)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       returning ${placeColumns}`,
      [
        organizationId,
        values.name,
        values.description,
        values.address,
        values.accessInfo,
        values.accessRestriction,
        values.latitude,
        values.longitude,
        values.visitRadiusM,
      ],
    );

    return rows[0] as PlaceRow;
  },

  async findEditablePlace(tx, id) {
    return first(
      await tx.em.execute<PlaceRow[]>(
        `select ${placeColumns}
           from public.places
          where id = ? and app_org_permission(organization_id) = 'full_edit'`,
        [id],
      ),
    );
  },

  async placeInOrganization(tx, placeId, organizationId) {
    const rows = await tx.em.execute<{ id: string }[]>(
      `select id
         from public.places
        where id = ? and organization_id = ? and app_org_permission(organization_id) = 'full_edit'`,
      [placeId, organizationId],
    );

    return rows.length > 0;
  },

  async markDescriptionCurated(tx, placeId) {
    await tx.em.execute(
      `update public.place_sources
          set description_method = 'curator'
        where place_id = ? and description_method <> 'curator'`,
      [placeId],
      "run",
    );
  },

  async updatePlace(tx, id, version, values) {
    return first(
      await tx.em.execute<PlaceRow[]>(
        `update public.places
            set name = ?, description = ?, address = ?, access_info = ?,
                access_restriction = ?, latitude = ?, longitude = ?, visit_radius_m = ?,
                version = version + 1, updated_at = now()
          where id = ? and version = ?
          returning ${placeColumns}`,
        [
          values.name,
          values.description,
          values.address,
          values.accessInfo,
          values.accessRestriction,
          values.latitude,
          values.longitude,
          values.visitRadiusM,
          id,
          version,
        ],
      ),
    );
  },

  async linkPlace(tx, collectionId, placeId, organizationId, position) {
    const rows = await tx.em.execute<{ placeId: string }[]>(
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values (?, ?, ?, ?)
       on conflict (collection_id, place_id) do nothing
       returning place_id as "placeId"`,
      [collectionId, placeId, organizationId, position],
    );

    return rows.length > 0;
  },

  async unlinkPlace(tx, collectionId, placeId) {
    const rows = await tx.em.execute<{ placeId: string }[]>(
      `delete from public.collection_places
        where collection_id = ? and place_id = ?
        returning place_id as "placeId"`,
      [collectionId, placeId],
    );

    return rows.length > 0;
  },

  async reorderPlaces(tx, collectionId, placeIds) {
    // One statement; the unique position is deferred to the end of the
    // transaction, so the intermediate state may repeat a position.
    await tx.em.execute(
      `update public.collection_places cp
          set position = v.pos
         from (select value::uuid as place_id, ord::int as pos
                 from jsonb_array_elements_text(?::jsonb) with ordinality as t(value, ord)) v
        where cp.collection_id = ? and cp.place_id = v.place_id`,
      [JSON.stringify(placeIds), collectionId],
    );
  },

  async findPublishedCollection(tx: TransactionContext, slug) {
    const collection = first(
      await tx.em.execute<
        (Omit<PublishedCollection, "organization" | "places" | "contentUpdatedAt" | "cover"> & {
          organizationName: string;
          organizationSlug: string;
          contentUpdatedAt: string;
        })[]
      >(
        // The count and the date read the same rows as the list of places below (a place
        // joined through `collection_places`, in the guest context), so they never show more
        // than the page lists. `greatest` skips a null (a collection without places).
        `select c.id, c.slug, c.title, c.summary, c.region,
                o.name as "organizationName", o.slug as "organizationSlug",
                (select count(*)::int
                   from public.collection_places cp
                   join public.places p on p.id = cp.place_id
                  where cp.collection_id = c.id) as "placeCount",
                to_char(
                  greatest(
                    c.updated_at,
                    (select max(cp.added_at)
                       from public.collection_places cp
                       join public.places p on p.id = cp.place_id
                      where cp.collection_id = c.id),
                    (select max(p.updated_at)
                       from public.collection_places cp
                       join public.places p on p.id = cp.place_id
                      where cp.collection_id = c.id)
                  ) at time zone 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                ) as "contentUpdatedAt"
           from public.collections c
           join public.organizations o on o.id = c.organization_id
          where c.slug = ? and ${publishedCollection}`,
        [slug],
      ),
    );

    if (collection === null) {
      return null;
    }

    // The thumbnail of a card is the first ready photo of the place by position, the same photo as
    // the cover of the place page. The guest context leaves only a photo everyone may see; only
    // public columns are read.
    const placeRows = await tx.em.execute<
      (Omit<PublishedCollection["places"][number], "thumb"> & {
        photoId: string | null;
        photoWidth: number | null;
        photoHeight: number | null;
      })[]
    >(
      `select p.id, p.name, p.address, (row_number() over (order by cp.position))::int as position,
              p.latitude, p.longitude,
              ph.id as "photoId", ph.width as "photoWidth", ph.height as "photoHeight"
         from public.collection_places cp
         join public.places p on p.id = cp.place_id
         left join lateral (
           select id, width, height
             from public.place_photos
            where place_id = p.id and file_state = 'ready' and storage_key is not null
            order by position
            limit 1
         ) ph on true
        where cp.collection_id = ?
        order by cp.position`,
      [collection.id],
    );
    const places = placeRows.map(({ photoId, photoWidth, photoHeight, ...place }) => ({
      ...place,
      thumb:
        photoId === null || photoWidth === null || photoHeight === null
          ? null
          : { photoId, width: photoWidth, height: photoHeight },
    }));
    // The cover with its credit. The guest context leaves only a photo everyone may see; the
    // application role has no grant on the `hidden_*` columns, so the query does not read them.
    const cover = first(
      await tx.em.execute<NonNullable<PublishedCollection["cover"]>[]>(
        `select ${coverCreditColumns("ph")},
                ph.place_id as "placeId", pl.name as "placeName"
           from public.collections c
           ${collectionCoverLateral("ph")}
           join public.places pl on pl.id = ph.place_id
          where c.id = ? and ph.id is not null`,
        [collection.id],
      ),
    );
    const { organizationName, organizationSlug, contentUpdatedAt, ...rest } = collection;

    return {
      ...rest,
      contentUpdatedAt: new Date(contentUpdatedAt),
      organization: { name: organizationName, slug: organizationSlug },
      places,
      cover,
    };
  },

  async listRecentlyPublishedCollections(tx: TransactionContext, limit) {
    const rows = await tx.em.execute<CollectionCardRow[]>(
      `select ${collectionCardColumns}
         from public.collections c
         join public.organizations o on o.id = c.organization_id
         ${collectionCardJoin}
        where c.status = 'published' and o.status = 'approved'
        order by c.first_published_at desc, c.id
        limit ?`,
      [limit],
    );

    return rows.map(toRecentCollection);
  },

  async listCollectionsPublishedSince(tx: TransactionContext, since, limit) {
    const rows = await tx.em.execute<(CollectionCardRow & { firstPublishedAt: Date | string })[]>(
      `select ${collectionCardColumns}, c.first_published_at as "firstPublishedAt"
         from public.collections c
         join public.organizations o on o.id = c.organization_id
         ${collectionCardJoin}
        where c.status = 'published' and o.status = 'approved'
          and c.first_published_at >= ?
        order by c.first_published_at desc, c.id
        limit ?`,
      [since, limit],
    );

    return rows.map(({ firstPublishedAt, ...row }) => ({
      ...toRecentCollection(row),
      firstPublishedAt: new Date(firstPublishedAt),
    }));
  },

  async countPlaceOfDayCandidates(tx: TransactionContext) {
    const rows = await tx.em.execute<{ count: number }[]>(
      `select count(*)::int as count
         from public.places p
        where ${placeOfDayCandidate}`,
    );

    return rows[0]?.count ?? 0;
  },

  async findPlaceOfDayAt(tx: TransactionContext, offset) {
    // Zdjęcie: pierwsze gotowe i widoczne dla gościa; kolekcja: pierwsza publiczna wg tytułu.
    const rows = await tx.em.execute<
      {
        id: string;
        name: string;
        description: string;
        collectionSlug: string;
        collectionTitle: string;
        photoId: string;
        width: number;
        height: number;
        altText: string;
      }[]
    >(
      `select p.id, p.name, p.description,
              pc.slug as "collectionSlug", pc.title as "collectionTitle",
              ph.id as "photoId", ph.width, ph.height, ph.alt_text as "altText"
         from public.places p
         join lateral (
           select c.slug, c.title
             from public.collection_places cp
             join public.collections c on c.id = cp.collection_id
             join public.organizations co on co.id = c.organization_id
            where cp.place_id = p.id and c.status = 'published' and co.status = 'approved'
            order by c.title, c.id
            limit 1
         ) pc on true
         join lateral (
           select x.id, x.width, x.height, x.alt_text
             from public.place_photos x
            where x.place_id = p.id and x.file_state = 'ready' and x.storage_key is not null
            order by x.position
            limit 1
         ) ph on true
        where ${placeOfDayCandidate}
        order by p.id
        offset ? limit 1`,
      [offset],
    );
    const row = rows[0];

    return row === undefined
      ? null
      : {
          id: row.id,
          name: row.name,
          description: row.description,
          collection: { slug: row.collectionSlug, title: row.collectionTitle },
          photo: {
            photoId: row.photoId,
            width: row.width,
            height: row.height,
            altText: row.altText,
          },
        };
  },

  async findCollectionBanner(tx: TransactionContext, slug) {
    // Okładka opublikowanej kolekcji z pełnym podpisem i miejscem zdjęcia (baner strony głównej).
    // Kontekst gościa zostawia tylko zdjęcie, które wolno zobaczyć każdemu.
    return first(
      await tx.em.execute<CollectionBanner[]>(
        `select ${coverCreditColumns("ph")},
                ph.place_id as "placeId", pl.name as "placeName"
           from public.collections c
           join public.organizations o on o.id = c.organization_id
           ${collectionCoverLateral("ph")}
           join public.places pl on pl.id = ph.place_id
          where c.slug = ? and c.status = 'published' and o.status = 'approved'
            and ph.id is not null`,
        [slug],
      ),
    );
  },

  async findHomeBannerCandidates(tx: TransactionContext, qids) {
    if (qids.length === 0) {
      return [];
    }

    // Pula banera (R3, PR 4): miejsce z listy QID, w opublikowanej kolekcji zatwierdzonej
    // organizacji, z pierwszym gotowym zdjęciem nadającym się na baner (>= 1100 px, nie szersze niż
    // 16:9). Kontekst gościa zostawia tylko zdjęcie, które wolno zobaczyć każdemu; kolumny
    // `hidden_*` nie są czytane. Miejsce z ograniczeniem dostępu (`access_restriction` inne niż
    // `none`) odpada, jak w „Miejscu dnia” (C-01). Ten sam QID u kilku miejsc daje jedno (najmniejsze `id`, stały wybór).
    return tx.em.execute<HomeBannerCandidate[]>(
      `select distinct on (s.wikidata_qid)
              s.wikidata_qid as qid,
              ph.id as "photoId", ph.width, ph.height, ph.alt_text as "altText", ph.title,
              ph.author_text as "authorText", ph.author_url as "authorUrl",
              ph.source_url as "sourceUrl", ph.source_kind as "sourceKind",
              ph.license_code as "licenseCode", ph.license_url as "licenseUrl",
              ph.license_label as "licenseLabel",
              p.id as "placeId", p.name as "placeName"
         from public.places p
         join public.organizations o on o.id = p.organization_id
         join public.place_sources s on s.place_id = p.id
         join lateral (
           select x.id, x.width, x.height, x.alt_text, x.title, x.author_text, x.author_url,
                  x.source_url, x.source_kind, x.license_code, x.license_url, x.license_label
             from public.place_photos x
            where x.place_id = p.id and x.file_state = 'ready' and x.storage_key is not null
              and x.width >= 1100 and x.width * 9 <= x.height * 16
            order by x.position
            limit 1
         ) ph on true
        where s.wikidata_qid in (${qids.map(() => "?").join(", ")})
          and p.access_restriction = 'none'
          and o.status = 'approved'
          and exists (
            select
              from public.collection_places cp
              join public.collections c on c.id = cp.collection_id
              join public.organizations co on co.id = c.organization_id
             where cp.place_id = p.id and c.status = 'published' and co.status = 'approved'
          )
        order by s.wikidata_qid, p.id`,
      [...qids],
    );
  },

  async findPublishedPlace(tx: TransactionContext, id) {
    const place = first(
      await tx.em.execute<
        (Omit<PublishedPlace, "organization" | "collections" | "source" | "cover"> & {
          organizationName: string;
          organizationSlug: string;
          attribution: string | null;
          wikipediaUrl: string | null;
          wikidataQid: string | null;
        })[]
      >(
        `select p.id, p.name, p.description, p.address, p.access_info as "accessInfo",
                p.access_restriction as "accessRestriction", p.latitude, p.longitude, p.visit_radius_m as "visitRadiusM",
                o.name as "organizationName", o.slug as "organizationSlug",
                s.attribution, s.wikipedia_url as "wikipediaUrl", s.wikidata_qid as "wikidataQid"
           from public.places p
           join public.organizations o on o.id = p.organization_id
           left join public.place_sources s on s.place_id = p.id
          where p.id = ?
            and o.status = 'approved'
            and exists (
              select
                from public.collection_places cp
                join public.collections c on c.id = cp.collection_id
                join public.organizations co on co.id = c.organization_id
               where cp.place_id = p.id and c.status = 'published' and co.status = 'approved'
            )`,
        [id],
      ),
    );

    if (place === null) {
      return null;
    }

    // The card of each collection (D-57, Q8): number of this place, count of places, date of the
    // last change (same rule as the collection page) and the cover: the chosen one, else the first
    // ready photo of the collection's places by position. Guest context: the policy of
    // `place_photos` leaves only photos everyone may see.
    const collectionRows = await tx.em.execute<
      (Omit<PlaceCollection, "contentUpdatedAt" | "cover"> & {
        contentUpdatedAt: string;
        coverPhotoId: string | null;
        coverWidth: number | null;
        coverHeight: number | null;
        coverAltText: string | null;
      })[]
    >(
      `select c.id, c.slug, c.title, c.region,
              (select count(*)::int from public.collection_places x
                where x.collection_id = c.id and x.position <= cp.position) as position,
              (select count(*)::int from public.collection_places x
                 join public.places xp on xp.id = x.place_id
                where x.collection_id = c.id) as "placeCount",
              to_char(
                greatest(
                  c.updated_at,
                  (select max(x.added_at) from public.collection_places x
                     join public.places xp on xp.id = x.place_id
                    where x.collection_id = c.id),
                  (select max(xp.updated_at) from public.collection_places x
                     join public.places xp on xp.id = x.place_id
                    where x.collection_id = c.id)
                ) at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ) as "contentUpdatedAt",
              ${coverCardColumns("cph")}
         from public.collection_places cp
         join public.collections c on c.id = cp.collection_id
         join public.organizations o on o.id = c.organization_id
         ${collectionCardJoin}
        where cp.place_id = ? and c.status = 'published' and o.status = 'approved'
        order by c.title, c.slug`,
      [id],
    );
    const collections: PlaceCollection[] = collectionRows.map(
      ({ contentUpdatedAt, coverPhotoId, coverWidth, coverHeight, coverAltText, ...rest }) => ({
        ...rest,
        contentUpdatedAt: new Date(contentUpdatedAt),
        cover: toCardCover({ coverPhotoId, coverWidth, coverHeight, coverAltText }),
      }),
    );
    // The cover: the first ready photo by position. This runs in the guest context, so the policy
    // of `place_photos` leaves only what everyone may see (a hidden photo never comes back); the
    // application role has no grant on the `hidden_*` columns, so the query does not read them.
    const cover = first(
      await tx.em.execute<NonNullable<PublishedPlace["cover"]>[]>(
        `select id as "photoId", width, height, alt_text as "altText", title,
                author_text as "authorText", author_url as "authorUrl", source_url as "sourceUrl",
                source_kind as "sourceKind", license_code as "licenseCode",
                license_url as "licenseUrl", license_label as "licenseLabel"
           from public.place_photos
          where place_id = ? and file_state = 'ready' and storage_key is not null
          order by position
          limit 1`,
        [id],
      ),
    );
    const { organizationName, organizationSlug, attribution, wikipediaUrl, wikidataQid, ...rest } =
      place;

    return {
      ...rest,
      organization: { name: organizationName, slug: organizationSlug },
      collections,
      source: attribution === null ? null : { attribution, wikipediaUrl, wikidataQid },
      cover,
    };
  },

  async listNearbyCandidates(tx, limit) {
    // Public data only: the guest context, the collection published by an approved organization,
    // and only the places that lie in a public collection (the same fragments as the album).
    // A collection without such a place does not come back. The coordinates of each place, rounded
    // to 3 decimals (about 100 m: enough for a distance in km), go to the browser only on request
    // ("Pokaż najbliższe", /api/nearby), which counts the distance to the nearest one (R-067).
    const rows = await tx.em.execute<
      {
        slug: string;
        title: string;
        region: string;
        placeCount: number;
        points: [number, number][];
        firstPublishedAt: Date | null;
      }[]
    >(
      `select c.slug, c.title, c.region, count(*)::int as "placeCount",
              json_agg(json_build_array(round(p.latitude::numeric, 3)::float8,
                                        round(p.longitude::numeric, 3)::float8)
                       order by cp.position, p.id) as "points",
              c.first_published_at as "firstPublishedAt"
         from public.collections c
         join public.organizations o on o.id = c.organization_id
         join public.collection_places cp on cp.collection_id = c.id
         join public.places p on p.id = cp.place_id
        where ${publishedCollection} and ${placeInPublicCollection}
        group by c.id
       having count(*) > 0
        order by c.first_published_at desc nulls last, c.id
        limit ?`,
      [limit],
    );

    return rows.map(({ firstPublishedAt, ...rest }) => ({
      ...rest,
      firstPublishedAt: firstPublishedAt === null ? null : new Date(firstPublishedAt).toISOString(),
    }));
  },

  async listAllPublishedCollections(tx, region, limit) {
    const rows = await tx.em.execute<CollectionCardRow[]>(
      `select ${collectionCardColumns}
         from public.collections c
         join public.organizations o on o.id = c.organization_id
         ${collectionCardJoin}
        where ${publishedCollection} ${region === null ? "" : "and c.region = ?"}
        order by c.title, c.id
        limit ?`,
      region === null ? [limit] : [region, limit],
    );

    return rows.map(toRecentCollection);
  },

  async searchPublicCatalog(tx, criteria, limit) {
    // The scan has no index (D-E12-10): the time limit protects the database, and the
    // transaction is read only. `set local` ends with the transaction. The limit is one
    // budget for both queries: the second gets what the first left (a whole number of ms).
    const startedAt = Date.now();
    const limitStatement = () =>
      tx.em.execute(
        `set local statement_timeout = '${remainingBudgetMs(SEARCH_TIME_BUDGET_MS, Date.now() - startedAt)}ms'`,
      );

    await limitStatement();

    const region = criteria.region;
    const regionFilter = region === null ? [] : [region];
    // One more than shown: the extra row only says "there is more".
    const take = limit + 1;
    const collections = await tx.em.execute<CollectionCardRow[]>(
      `select ${collectionCardColumns}
         from public.collections c
         join public.organizations o on o.id = c.organization_id
         ${collectionCardJoin}
        where ${publishedCollection} ${region === null ? "" : "and c.region = ?"}
          and (${foldSql("c.title")} ${LIKE}
            or ${foldSql("c.summary")} ${LIKE}
            or c.region in (select jsonb_array_elements_text(?::jsonb)))
        order by (${foldSql("c.title")} ${LIKE}) desc, c.title, c.id
        limit ?`,
      [
        ...regionFilter,
        criteria.contains,
        criteria.contains,
        JSON.stringify(criteria.namedRegions),
        criteria.prefix,
        take,
      ],
    );
    await limitStatement();
    // The place counts in its first public collection (by title); with a region filter,
    // in the first one of that region. The guard of the place is the same as in the album.
    const places = await tx.em.execute<
      (Omit<SearchPlaceHit, "collection"> & { collectionSlug: string; collectionTitle: string })[]
    >(
      `select p.id, p.name, p.address, pc.slug as "collectionSlug", pc.title as "collectionTitle"
         from public.places p
        cross join lateral (
          select c.slug, c.title
            from public.collection_places cp
            join public.collections c on c.id = cp.collection_id
            join public.organizations o on o.id = c.organization_id
           where cp.place_id = p.id and ${publishedCollection}
             ${region === null ? "" : "and c.region = ?"}
           order by c.title, c.slug
           limit 1
        ) pc
        where ${placeInPublicCollection}
          and (${foldSql("p.name")} ${LIKE} or ${foldSql("p.address")} ${LIKE})
        order by (${foldSql("p.name")} ${LIKE}) desc, p.name, p.id
        limit ?`,
      [...regionFilter, criteria.contains, criteria.contains, criteria.prefix, take],
    );

    return {
      collections: collections.map(toRecentCollection),
      places: places.map(({ collectionSlug, collectionTitle, ...rest }) => ({
        ...rest,
        collection: { slug: collectionSlug, title: collectionTitle },
      })),
    };
  },

  isSearchTimeout: isQueryCancelled,
};
