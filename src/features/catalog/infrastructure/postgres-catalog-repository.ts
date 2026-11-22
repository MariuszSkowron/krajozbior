import "server-only";

import { placeInPublicCollection, publishedCollection } from "./public-visibility";
import type { TransactionContext } from "@/lib/db/user-context";

import type {
  CatalogRepository,
  CollectionRow,
  CuratorCollectionSummary,
  CuratorOwnPlace,
  CuratorPlaceItem,
  PlaceRow,
  PublishedCollection,
  PublishedPlace,
  RecentCollection,
  SearchPlaceHit,
} from "../application/catalog-types";
import type { CollectionStatus, Region } from "../domain/collection";
import { MAX_COLLECTIONS_PER_LIST, MAX_PLACES_PER_COLLECTION } from "../domain/limits";
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
};

const toRecentCollection = ({
  organizationName,
  ...rest
}: CollectionCardRow): RecentCollection => ({
  ...rest,
  organization: { name: organizationName },
});

// The columns of a collection card (public fields only); the collection is `c`, its organization `o`.
const collectionCardColumns = `c.id, c.slug, c.title, c.region, o.name as "organizationName",
  (select count(*)::int from public.collection_places cp
    where cp.collection_id = c.id) as "placeCount"`;

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

  async listOrganizationCollections(tx, organizationId) {
    // The driver returns timestamptz as text here.
    const rows = await tx.em.execute<
      (Omit<CuratorCollectionSummary, "updatedAt"> & { updatedAt: string | Date })[]
    >(
      `select c.id, c.title, c.region, c.status,
              (select count(*)::int from public.collection_places cp where cp.collection_id = c.id)
                as "placeCount",
              to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "updatedAt"
         from public.collections c
        where c.organization_id = ? and app_org_permission(c.organization_id) = 'full_edit'
        order by c.updated_at desc, c.id
        limit ?`,
      [organizationId, MAX_COLLECTIONS_PER_LIST],
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
        (Omit<PublishedCollection, "organization" | "places" | "contentUpdatedAt"> & {
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

    const places = await tx.em.execute<PublishedCollection["places"][number][]>(
      `select p.id, p.name, p.address, cp.position, p.latitude, p.longitude
         from public.collection_places cp
         join public.places p on p.id = cp.place_id
        where cp.collection_id = ?
        order by cp.position`,
      [collection.id],
    );
    const { organizationName, organizationSlug, contentUpdatedAt, ...rest } = collection;

    return {
      ...rest,
      contentUpdatedAt: new Date(contentUpdatedAt),
      organization: { name: organizationName, slug: organizationSlug },
      places,
    };
  },

  async listRecentlyPublishedCollections(tx: TransactionContext, limit) {
    const rows = await tx.em.execute<
      {
        id: string;
        slug: string;
        title: string;
        region: RecentCollection["region"];
        organizationName: string;
        placeCount: number;
      }[]
    >(
      `select c.id, c.slug, c.title, c.region, o.name as "organizationName",
              (select count(*)::int from public.collection_places cp
                where cp.collection_id = c.id) as "placeCount"
         from public.collections c
         join public.organizations o on o.id = c.organization_id
        where c.status = 'published' and o.status = 'approved'
        order by c.first_published_at desc, c.id
        limit ?`,
      [limit],
    );

    return rows.map(({ organizationName, ...rest }) => ({
      ...rest,
      organization: { name: organizationName },
    }));
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

    const collections = await tx.em.execute<PublishedPlace["collections"][number][]>(
      `select c.slug, c.title
         from public.collection_places cp
         join public.collections c on c.id = cp.collection_id
         join public.organizations o on o.id = c.organization_id
        where cp.place_id = ? and c.status = 'published' and o.status = 'approved'
        order by c.title, c.slug`,
      [id],
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
    // A collection without such a place has no centre and does not come back.
    const rows = await tx.em.execute<
      {
        slug: string;
        title: string;
        region: string;
        placeCount: number;
        centerLat: number;
        centerLon: number;
        firstPublishedAt: Date | null;
      }[]
    >(
      `select c.slug, c.title, c.region, count(*)::int as "placeCount",
              avg(p.latitude)::float8 as "centerLat", avg(p.longitude)::float8 as "centerLon",
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
