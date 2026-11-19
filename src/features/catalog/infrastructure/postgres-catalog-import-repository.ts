import "server-only";

import type {
  CatalogImportRepository,
  ImportEntityKind,
  ImportKeyRow,
  ImportKeyValues,
} from "../application/catalog-import-types";

// Raw SQL on the transaction of the loader (context of the curator), so the
// row policies of `catalog_import_keys` and of the catalog tables apply. The
// keys of other organizations are never visible, and every statement names the
// organization the loader resolved for the curator.

// The list of places as a uuid[] built from JSON (the driver expands a JS
// array bound to `?`), `null` stays `null`.
const placesSql = `case when ?::jsonb is null then null
  else coalesce((select array_agg(v::uuid order by ord)
                   from jsonb_array_elements_text(?::jsonb) with ordinality as t(v, ord)),
                '{}'::uuid[]) end`;

const placesParams = (places: readonly string[] | null): [string | null, string | null] => {
  const json = places === null ? null : JSON.stringify(places);

  return [json, json];
};

export const postgresCatalogImportRepository: CatalogImportRepository = {
  async lockImport(tx, organizationId) {
    // A statement of its own: the next one gets a snapshot taken after the lock
    // (READ COMMITTED). The key differs from `organization_collections:<id>`.
    await tx.em.execute(
      `select pg_advisory_xact_lock(hashtextextended(?::text, 0))`,
      [`catalog_import:${organizationId}`],
      "get",
    );
  },

  async setReadOnly(tx) {
    await tx.em.execute(`set transaction read only`, [], "run");
  },

  async findOrganizationIdBySlug(tx, slug) {
    const rows = await tx.em.execute<{ id: string }[]>(
      `select id from public.organizations where slug = ?`,
      [slug],
    );

    return rows[0]?.id ?? null;
  },

  async readKeys(tx, organizationId) {
    return tx.em.execute<ImportKeyRow[]>(
      `select entity_kind as kind, import_key as "importKey", entity_id as "entityId",
              batch_id as "batchId", imported_version as "importedVersion",
              to_jsonb(imported_places) as "importedPlaces"
         from public.catalog_import_keys
        where organization_id = ?
        order by entity_kind, import_key`,
      [organizationId],
    );
  },

  async insertKey(
    tx,
    organizationId: string,
    kind: ImportEntityKind,
    importKey: string,
    values: ImportKeyValues,
  ) {
    await tx.em.execute(
      `insert into public.catalog_import_keys
         (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version, imported_places)
       values (?, ?, ?, ?, ?, ?, ${placesSql})`,
      [
        organizationId,
        kind,
        importKey,
        values.entityId,
        values.batchId,
        values.importedVersion,
        ...placesParams(values.importedPlaces),
      ],
    );
  },

  async updateKey(
    tx,
    organizationId: string,
    kind: ImportEntityKind,
    importKey: string,
    values: ImportKeyValues,
  ) {
    await tx.em.execute(
      `update public.catalog_import_keys
          set entity_id = ?, batch_id = ?, imported_version = ?,
              imported_places = ${placesSql}, imported_at = now()
        where organization_id = ? and entity_kind = ? and import_key = ?`,
      [
        values.entityId,
        values.batchId,
        values.importedVersion,
        ...placesParams(values.importedPlaces),
        organizationId,
        kind,
        importKey,
      ],
    );
  },

  async countCollections(tx, organizationId) {
    const rows = await tx.em.execute<{ count: number }[]>(
      `select count(*)::int as count from public.collections where organization_id = ?`,
      [organizationId],
    );

    return rows[0]?.count ?? 0;
  },

  async countOrphanedKeys(tx, organizationId) {
    const rows = await tx.em.execute<{ kind: ImportEntityKind; count: number }[]>(
      `select k.entity_kind as kind, count(*)::int as count
         from public.catalog_import_keys k
        where k.organization_id = ?
          and not exists (
            select from public.places p where k.entity_kind = 'place' and p.id = k.entity_id)
          and not exists (
            select from public.collections c where k.entity_kind = 'collection' and c.id = k.entity_id)
        group by k.entity_kind`,
      [organizationId],
    );
    const counts = { collection: 0, place: 0 };

    for (const row of rows) {
      counts[row.kind] = row.count;
    }

    return counts;
  },
};
