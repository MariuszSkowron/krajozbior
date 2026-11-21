import "server-only";

import type { Client } from "pg";

import type { PendingPhoto, PhotoFetchRepository } from "../application/fetch-photos";

// Dostęp do `place_photos` jako `krajozbior_ops` (DATABASE_OPS_URL) na jednym połączeniu, które
// trzyma też blokadę doradczą (sesyjną) na czas całego polecenia. Każda zmiana wiersza to osobna,
// krótka instrukcja (autocommit), więc przerwane polecenie można uruchomić ponownie.

/** Wspólna blokada `photos:fetch` i `photos:sweep` (5.11.5): drugie uruchomienie nie wystartuje. */
export const MEDIA_LOCK_KEY = "krajozbior:media";

export async function tryMediaLock(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ locked: boolean }>(
    `select pg_try_advisory_lock(hashtextextended($1::text, 0)) as locked`,
    [MEDIA_LOCK_KEY],
  );

  return rows[0]?.locked === true;
}

export async function releaseMediaLock(client: Client): Promise<void> {
  await client.query(`select pg_advisory_unlock(hashtextextended($1::text, 0))`, [MEDIA_LOCK_KEY]);
}

export function createPostgresPhotoFetchRepository(client: Client): PhotoFetchRepository {
  return {
    async listPending({ limit, retryFailed, organizationSlug }) {
      const states = retryFailed ? ["pending_fetch", "fetch_failed"] : ["pending_fetch"];
      const { rows } = await client.query<{
        id: string;
        commons_file: string;
        source_width: number | null;
        fetch_attempts: number;
      }>(
        `select ph.id, ph.commons_file, ph.source_width, ph.fetch_attempts
           from public.place_photos ph
          where ph.source_kind = 'commons_import'
            and ph.file_state = any($1::text[])
            and ($3::text is null or ph.organization_id = (
                  select o.id from public.organizations o where o.slug = $3::text))
          order by ph.created_at, ph.id
          limit $2`,
        [states, limit, organizationSlug ?? null],
      );

      return rows.map((row): PendingPhoto => ({
        id: row.id,
        commonsFile: row.commons_file,
        sourceWidth: row.source_width,
        fetchAttempts: row.fetch_attempts,
      }));
    },

    async markReady(photoId, values) {
      try {
        const { rowCount } = await client.query(
          `update public.place_photos
              set file_state = 'ready', storage_key = $2, width = $3, height = $4,
                  content_sha256 = $5, updated_at = now()
            where id = $1 and source_kind = 'commons_import'
              and file_state in ('pending_fetch', 'fetch_failed')`,
          [
            photoId,
            values.storageKey,
            values.width,
            values.height,
            Buffer.from(values.contentSha256),
          ],
        );

        if (rowCount !== 1) {
          throw new Error("place_photos: the update changed no row");
        }

        return "ok";
      } catch (error) {
        // Ten sam obraz w tym miejscu (`unique (place_id, content_sha256)`).
        if ((error as { code?: unknown } | null)?.code === "23505") {
          return "duplicate";
        }

        throw error;
      }
    },

    async recordFailure(photoId, attempts, state) {
      await client.query(
        `update public.place_photos
            set fetch_attempts = $2, file_state = $3, updated_at = now()
          where id = $1 and source_kind = 'commons_import'`,
        [photoId, attempts, state],
      );
    },

    async countPending() {
      const { rows } = await client.query<{ count: number }>(
        `select count(*)::int as count from public.place_photos
          where source_kind = 'commons_import' and file_state = 'pending_fetch'`,
      );

      return rows[0]?.count ?? 0;
    },

    async listReady() {
      const { rows } = await client.query<{ id: string; storage_key: string }>(
        `select id, storage_key from public.place_photos
          where source_kind = 'commons_import' and file_state = 'ready' and storage_key is not null
          order by created_at, id`,
      );

      return rows.map((row) => ({ id: row.id, storageKey: row.storage_key }));
    },

    async requeue(photoId) {
      await client.query(
        `update public.place_photos
            set file_state = 'pending_fetch', storage_key = null, width = null, height = null,
                content_sha256 = null, fetch_attempts = 0, updated_at = now()
          where id = $1 and source_kind = 'commons_import' and file_state = 'ready'`,
        [photoId],
      );
    },
  };
}
