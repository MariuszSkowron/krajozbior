import "server-only";

import type { TransactionContext } from "@/lib/db/user-context";

import type {
  CatalogRepository,
  CollectionRow,
  PlaceRow,
  PublishedCollection,
  PublishedPlace,
} from "../application/catalog-types";
import type { CollectionStatus } from "../domain/collection";

// Raw SQL on the transaction of the use case (user or guest context), so the
// row policies decide what each statement sees or changes. No statement names
// a user id: the owner of a write is the organization checked by the policies.
// Coordinates are bound parameters of a curator's own place, never a log field.

const collectionColumns = `c.id, c.slug, c.organization_id as "organizationId", c.title,
  c.summary, c.region, c.status, c.first_published_at as "firstPublishedAt", c.version`;
const returningCollection = `id, slug, organization_id as "organizationId", title,
  summary, region, status, first_published_at as "firstPublishedAt", version`;
const placeColumns = `id, organization_id as "organizationId", name, description, address,
  access_info as "accessInfo", latitude, longitude, visit_radius_m as "visitRadiusM", version`;

const first = <T>(rows: readonly T[]): T | null => rows[0] ?? null;

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

  async deleteCollection(tx, id) {
    const rows = await tx.em.execute<{ id: string }[]>(
      `delete from public.collections where id = ? returning id`,
      [id],
    );

    return rows.length > 0;
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
         (organization_id, name, description, address, access_info, latitude, longitude, visit_radius_m)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       returning ${placeColumns}`,
      [
        organizationId,
        values.name,
        values.description,
        values.address,
        values.accessInfo,
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

  async updatePlace(tx, id, version, values) {
    return first(
      await tx.em.execute<PlaceRow[]>(
        `update public.places
            set name = ?, description = ?, address = ?, access_info = ?,
                latitude = ?, longitude = ?, visit_radius_m = ?,
                version = version + 1, updated_at = now()
          where id = ? and version = ?
          returning ${placeColumns}`,
        [
          values.name,
          values.description,
          values.address,
          values.accessInfo,
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
        (Omit<PublishedCollection, "organization" | "places"> & {
          organizationName: string;
          organizationSlug: string;
        })[]
      >(
        `select c.id, c.slug, c.title, c.summary, c.region,
                o.name as "organizationName", o.slug as "organizationSlug"
           from public.collections c
           join public.organizations o on o.id = c.organization_id
          where c.slug = ? and c.status = 'published' and o.status = 'approved'`,
        [slug],
      ),
    );

    if (collection === null) {
      return null;
    }

    const places = await tx.em.execute<PublishedCollection["places"][number][]>(
      `select p.id, p.name, p.address, cp.position
         from public.collection_places cp
         join public.places p on p.id = cp.place_id
        where cp.collection_id = ?
        order by cp.position`,
      [collection.id],
    );
    const { organizationName, organizationSlug, ...rest } = collection;

    return { ...rest, organization: { name: organizationName, slug: organizationSlug }, places };
  },

  async findPublishedPlace(tx: TransactionContext, id) {
    const place = first(
      await tx.em.execute<
        (Omit<PublishedPlace, "organization" | "collections"> & {
          organizationName: string;
          organizationSlug: string;
        })[]
      >(
        `select p.id, p.name, p.description, p.address, p.access_info as "accessInfo",
                p.latitude, p.longitude, p.visit_radius_m as "visitRadiusM",
                o.name as "organizationName", o.slug as "organizationSlug"
           from public.places p
           join public.organizations o on o.id = p.organization_id
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
    const { organizationName, organizationSlug, ...rest } = place;

    return {
      ...rest,
      organization: { name: organizationName, slug: organizationSlug },
      collections,
    };
  },
};
