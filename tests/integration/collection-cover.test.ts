import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { getCuratorCollection } from "@/features/catalog/application/curator-queries";
import { setCollectionCover } from "@/features/catalog/application/curator-cover";
import {
  getPublishedCollection,
  listRecentlyPublishedCollections,
} from "@/features/catalog/application/public-catalog";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// Okładka kolekcji (E4-3) na prawdziwej bazie, przez połączenia ról: `krajozbior_app` w puli z
// jednym połączeniem (wyciek kontekstu byłby widoczny) i `krajozbior_ops` (pobieranie plików).
// Superużytkownik tylko przygotowuje wiersze, których role nie mogą zapisać, i czyta katalog.
// Okładka: tylko zdjęcie gotowe, nieukryte, z miejsca tej kolekcji (wyzwalacz
// `collections_cover_guard`); kuratorem okładki jest członek organizacji z `full_edit`; gość widzi
// okładkę tylko opublikowanej kolekcji.
const guardRejected = /collection cover photo/;

let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("cur-a");
const curB = user("cur-b");
const explorer = user("explorer");
const asActor = (actor: { id: string }) => ({ id: actor.id, role: "user" as const });

let orgA = "";
let orgB = "";
let counter = 0;

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const ops$ = (sql: string, params: unknown[] = []) =>
  withClient(db.urls.krajozbior_ops, (client) => client.query(sql, params));
const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
  runInUserContext(app.em, actor, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));
const asGuest = (sql: string, params: unknown[] = []) =>
  runInGuestContext(app.em, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));

const deps: CatalogDeps = {
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
};

const newPlace = async (organizationId: string): Promise<string> =>
  (
    await admin$<{ id: string }>(
      `insert into public.places (organization_id, name, latitude, longitude)
       values ($1, $2, 54.1, 18.7) returning id`,
      [organizationId, `Miejsce ${(counter += 1)}`],
    )
  )[0]!.id;

const newCollection = async (
  organizationId: string,
  placeIds: string[],
  published: boolean,
): Promise<{ id: string; slug: string }> => {
  const slug = `kolekcja-${(counter += 1)}`;
  const [{ id }] = await admin$<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, region, status)
     values ($1, $2, 'Kolekcja', 'pomorskie', 'draft') returning id`,
    [slug, organizationId],
  );

  for (const [index, placeId] of placeIds.entries()) {
    await admin$(
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values ($1, $2, $3, $4)`,
      [id, placeId, organizationId, index + 1],
    );
  }

  if (published) {
    await admin$(`update public.collections set status = 'published' where id = $1`, [id]);
  }

  return { id, slug };
};

const photo = async (
  placeId: string,
  organizationId: string,
  state: "ready" | "pending_fetch" = "ready",
): Promise<string> => {
  const n = (counter += 1);

  return (
    await admin$<{ id: string }>(
      `insert into public.place_photos
         (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
          source_kind, title, author_text, source_url, license_code, license_url, license_label,
          rights_statement, commons_file)
       values ($1, $2, $3, $4, $5, $6, $7, 'Opis zdjęcia', 'commons_import', 'Tytuł', 'Autor',
               'https://commons.wikimedia.org/wiki/File:X.jpg', 'cc-by-sa-4.0',
               'https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0',
               'commons-import/1', $8)
       returning id`,
      [
        organizationId,
        placeId,
        n,
        state,
        state === "ready" ? randomUUID() : null,
        state === "ready" ? 1280 : null,
        state === "ready" ? 853 : null,
        `Plik ${n}.jpg`,
      ],
    )
  )[0]!.id;
};

const coverOf = async (collectionId: string): Promise<string | null> =>
  (
    await admin$<{ cover: string | null }>(
      `select cover_place_photo_id as cover from public.collections where id = $1`,
      [collectionId],
    )
  )[0]!.cover;

// The raw UPDATE of a curator: how the use case sets the cover, without its checks.
const setRaw = (actor: { id: string }, collectionId: string, photoId: string | null) =>
  as(actor, `update public.collections set cover_place_photo_id = ? where id = ? returning id`, [
    photoId,
    collectionId,
  ]);

describe("collection cover", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_collection_cover");
    await db.migrate();

    for (const { id, email } of [curA, curB, explorer]) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }

    const org = async (slug: string, member: { id: string }) => {
      const [{ id }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ($1, $1, 'municipality') returning id`,
        [slug],
      );

      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [id, member.id],
      );

      return id;
    };

    orgA = await org("gmina-a", curA);
    orgB = await org("gmina-b", curB);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("keeps row security on `collections` and gives the app role only the update of the cover column", async () => {
    const gaps = await withClient(db.adminUrl, async (client) => [
      ...(await findRowLevelSecurityGaps(client, [
        "public.collections",
        "public.collection_places",
      ])),
      ...(await findApplicationRoleGaps(client)),
    ]);

    expect(gaps).toEqual([]);

    const privilege = async (role: string, privilegeName: string) =>
      (
        await admin$<{ allowed: boolean }>(
          `select has_column_privilege($1, 'public.collections', 'cover_place_photo_id', $2) as allowed`,
          [role, privilegeName],
        )
      )[0]!.allowed;

    // A new collection never has a cover (no INSERT grant); the cover is changed by UPDATE only.
    expect(await privilege("krajozbior_app", "update")).toBe(true);
    expect(await privilege("krajozbior_app", "insert")).toBe(false);
    expect(await privilege("krajozbior_ops", "update")).toBe(false);
    expect(await privilege("krajozbior_auth", "update")).toBe(false);
  });

  it("has an empty trigger function list for the app role: nobody can call the guards directly", async () => {
    const callable = await admin$<{ proname: string }>(
      `select p.proname
         from pg_proc p
        where p.proname in ('collections_cover_guard', 'place_photos_clear_cover',
                            'collection_places_clear_cover')
          and (has_function_privilege('krajozbior_app', p.oid, 'execute')
            or has_function_privilege('krajozbior_ops', p.oid, 'execute'))`,
    );

    expect(callable).toEqual([]);
  });

  describe("who may set the cover", () => {
    it("lets a curator of the organization choose and clear the cover of the own collection", async () => {
      const place = await newPlace(orgA);
      const photoId = await photo(place, orgA);
      const collection = await newCollection(orgA, [place], false);

      expect(
        await setCollectionCover(asActor(curA), collection.id, { placePhotoId: photoId }, deps),
      ).toEqual({ status: "ok", value: { coverPlacePhotoId: photoId } });
      expect(await coverOf(collection.id)).toBe(photoId);

      expect(await setCollectionCover(asActor(curA), collection.id, {}, deps)).toEqual({
        status: "ok",
        value: { coverPlacePhotoId: null },
      });
      expect(await coverOf(collection.id)).toBeNull();
    });

    it("refuses an account that is no curator, a guest, and a curator of another organization", async () => {
      const place = await newPlace(orgA);
      const photoId = await photo(place, orgA);
      const collection = await newCollection(orgA, [place], true);

      // Explorer: no membership at all.
      expect(
        await setCollectionCover(asActor(explorer), collection.id, { placePhotoId: photoId }, deps),
      ).toEqual({ status: "forbidden" });
      expect(await setRaw(explorer, collection.id, photoId)).toEqual([]);

      // Guest: no actor.
      expect(
        await setCollectionCover(null, collection.id, { placePhotoId: photoId }, deps),
      ).toEqual({ status: "unauthenticated" });

      // Curator of another organization: the collection does not exist for them (0 rows).
      expect(
        await setCollectionCover(asActor(curB), collection.id, { placePhotoId: photoId }, deps),
      ).toEqual({ status: "not_found" });
      expect(await setRaw(curB, collection.id, null)).toEqual([]);

      expect(await coverOf(collection.id)).toBeNull();
    });

    it("refuses the cover column to the app role on INSERT (a new collection has none)", async () => {
      await expect(
        as(
          curA,
          `insert into public.collections (slug, organization_id, title, region, cover_place_photo_id)
           values ('z-okladka-1', ?, 'T', 'pomorskie', ?)`,
          [orgA, randomUUID()],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe("which photo may be the cover (only photos of places of this collection)", () => {
    it("accepts a ready photo of a place in the collection, also a draft collection", async () => {
      const place = await newPlace(orgA);
      const photoId = await photo(place, orgA);
      const draft = await newCollection(orgA, [place], false);

      expect(await setRaw(curA, draft.id, photoId)).toHaveLength(1);
    });

    it("rejects a photo of a place that is not in the collection (23514)", async () => {
      const inside = await newPlace(orgA);
      const outside = await newPlace(orgA);
      const outsidePhoto = await photo(outside, orgA);
      const collection = await newCollection(orgA, [inside], true);

      await expect(setRaw(curA, collection.id, outsidePhoto)).rejects.toThrow(guardRejected);
      expect(
        await setCollectionCover(
          asActor(curA),
          collection.id,
          { placePhotoId: outsidePhoto },
          deps,
        ),
      ).toEqual({ status: "unprocessable", reason: "cover_not_allowed" });
      expect(await coverOf(collection.id)).toBeNull();
    });

    it("rejects a photo of another organization and a photo that does not exist", async () => {
      const own = await newPlace(orgA);
      const foreign = await newPlace(orgB);
      const foreignPhoto = await photo(foreign, orgB);
      const collection = await newCollection(orgA, [own], true);

      await expect(setRaw(curA, collection.id, foreignPhoto)).rejects.toThrow();
      // The use case gives the same answer for both: nothing says whether the photo exists.
      for (const placePhotoId of [foreignPhoto, randomUUID()]) {
        expect(
          await setCollectionCover(asActor(curA), collection.id, { placePhotoId }, deps),
        ).toEqual({ status: "unprocessable", reason: "cover_not_allowed" });
      }
    });

    it("rejects a photo that is not ready, and a photo hidden by an administrator", async () => {
      const place = await newPlace(orgA);
      const pending = await photo(place, orgA, "pending_fetch");
      const hidden = await photo(place, orgA);
      const collection = await newCollection(orgA, [place], true);

      await admin$(`update public.place_photos set hidden_at = now() where id = $1`, [hidden]);

      await expect(setRaw(curA, collection.id, pending)).rejects.toThrow(guardRejected);
      await expect(setRaw(curA, collection.id, hidden)).rejects.toThrow(guardRejected);
      expect(await coverOf(collection.id)).toBeNull();
    });

    it("lists only ready photos of the places of the collection for the picker", async () => {
      const inA = await newPlace(orgA);
      const inB = await newPlace(orgA);
      const outside = await newPlace(orgA);
      const ready = await photo(inA, orgA);
      await photo(inA, orgA, "pending_fetch");
      const second = await photo(inB, orgA);
      await photo(outside, orgA);
      const collection = await newCollection(orgA, [inA, inB], false);

      const detail = await getCuratorCollection(asActor(curA), collection.id, deps);

      expect(detail.status === "ok" && detail.value.coverCandidates.map((c) => c.photoId)).toEqual([
        ready,
        second,
      ]);
      expect(detail.status === "ok" && detail.value.coverPlacePhotoId).toBeNull();
      // Curator of another organization: the collection does not exist for them.
      expect(await getCuratorCollection(asActor(curB), collection.id, deps)).toEqual({
        status: "not_found",
      });
    });
  });

  describe("what a guest sees", () => {
    it("shows the cover of a published collection, on the page and on the card", async () => {
      const place = await newPlace(orgA);
      const photoId = await photo(place, orgA);
      const collection = await newCollection(orgA, [place], true);

      await setCollectionCover(asActor(curA), collection.id, { placePhotoId: photoId }, deps);

      const page = await getPublishedCollection(collection.slug, deps);

      expect(page.status === "ok" && page.value.cover).toMatchObject({
        photoId,
        width: 1280,
        height: 853,
        altText: "Opis zdjęcia",
        authorText: "Autor",
        licenseLabel: "CC BY-SA 4.0",
      });

      const cards = await listRecentlyPublishedCollections(200, deps);
      const card = cards.find((item) => item.id === collection.id);

      // The card carries the file and the description, never the author or a column of a curator.
      expect(card?.cover).toEqual({
        photoId,
        width: 1280,
        height: 853,
        altText: "Opis zdjęcia",
      });
    });

    it("shows no cover of a draft: the draft, its cover and its photo do not exist for a guest", async () => {
      const place = await newPlace(orgA);
      const photoId = await photo(place, orgA);
      const draft = await newCollection(orgA, [place], false);

      await setCollectionCover(asActor(curA), draft.id, { placePhotoId: photoId }, deps);

      expect(await coverOf(draft.id)).toBe(photoId);
      expect(await getPublishedCollection(draft.slug, deps)).toEqual({ status: "not_found" });
      expect(
        await asGuest(`select cover_place_photo_id from public.collections where id = ?`, [
          draft.id,
        ]),
      ).toEqual([]);
      expect(await asGuest(`select id from public.place_photos where id = ?`, [photoId])).toEqual(
        [],
      );
      expect(
        (await listRecentlyPublishedCollections(200, deps)).some((item) => item.id === draft.id),
      ).toBe(false);
      // The curator of the organization still sees the choice.
      const detail = await getCuratorCollection(asActor(curA), draft.id, deps);

      expect(detail.status === "ok" && detail.value.coverPlacePhotoId).toBe(photoId);
    });

    it("drops the cover from the public page after the collection is withdrawn", async () => {
      const place = await newPlace(orgA);
      const photoId = await photo(place, orgA);
      const collection = await newCollection(orgA, [place], true);

      await setCollectionCover(asActor(curA), collection.id, { placePhotoId: photoId }, deps);
      await admin$(`update public.collections set status = 'draft' where id = $1`, [collection.id]);

      expect(await getPublishedCollection(collection.slug, deps)).toEqual({ status: "not_found" });
    });

    it("keeps no cover on a card when the photo is no longer visible to a guest", async () => {
      const place = await newPlace(orgA);
      const photoId = await photo(place, orgA);
      const collection = await newCollection(orgA, [place], true);

      await setCollectionCover(asActor(curA), collection.id, { placePhotoId: photoId }, deps);
      // The trigger clears it; even before it, the policy of `place_photos` leaves no hidden photo.
      await admin$(`alter table public.place_photos disable trigger place_photos_clear_cover`);

      try {
        await admin$(`update public.place_photos set hidden_at = now() where id = $1`, [photoId]);

        const page = await getPublishedCollection(collection.slug, deps);
        const card = (await listRecentlyPublishedCollections(200, deps)).find(
          (item) => item.id === collection.id,
        );

        expect(page.status === "ok" && page.value.cover).toBeNull();
        expect(card?.cover).toBeNull();
      } finally {
        await admin$(`alter table public.place_photos enable trigger place_photos_clear_cover`);
      }
    });
  });

  describe("the cover disappears when its photo stops qualifying", () => {
    const withCover = async () => {
      const place = await newPlace(orgA);
      const photoId = await photo(place, orgA);
      const collection = await newCollection(orgA, [place], true);

      await setCollectionCover(asActor(curA), collection.id, { placePhotoId: photoId }, deps);
      expect(await coverOf(collection.id)).toBe(photoId);

      return { place, photoId, collection };
    };

    it("when an administrator hides the photo (the other collection keeps its own cover)", async () => {
      const { place, photoId, collection } = await withCover();
      const otherPhoto = await photo(place, orgA);
      const other = await newCollection(orgA, [place], true);

      await setCollectionCover(asActor(curA), other.id, { placePhotoId: otherPhoto }, deps);
      await admin$(`update public.place_photos set hidden_at = now() where id = $1`, [photoId]);

      expect(await coverOf(collection.id)).toBeNull();
      expect(await coverOf(other.id)).toBe(otherPhoto);
    });

    it("when the file is no longer ready (written by the operator role)", async () => {
      const { photoId, collection } = await withCover();

      await ops$(`update public.place_photos set file_state = 'fetch_failed' where id = $1`, [
        photoId,
      ]);

      expect(await coverOf(collection.id)).toBeNull();
    });

    it("when the place leaves the collection (a curator removes the link)", async () => {
      const { place, collection } = await withCover();
      const stay = await newPlace(orgA);
      const stayPhoto = await photo(stay, orgA);
      const other = await newCollection(orgA, [place, stay], true);

      await setCollectionCover(asActor(curA), other.id, { placePhotoId: stayPhoto }, deps);
      await as(
        curA,
        `delete from public.collection_places where collection_id = ? and place_id = ?`,
        [collection.id, place],
      );

      expect(await coverOf(collection.id)).toBeNull();
      expect(await coverOf(other.id)).toBe(stayPhoto);
    });

    it("when the photo is deleted (the key is set to null)", async () => {
      const { photoId, collection } = await withCover();

      await as(curA, `delete from public.place_photos where id = ?`, [photoId]);

      expect(await coverOf(collection.id)).toBeNull();
    });

    it("keeps the cover when an unrelated column of the photo changes", async () => {
      const { photoId, collection } = await withCover();

      await as(curA, `update public.place_photos set alt_text = 'Nowy opis' where id = ?`, [
        photoId,
      ]);

      expect(await coverOf(collection.id)).toBe(photoId);
    });
  });

  it("does not leak the context: the next statement on the same connection has no actor", async () => {
    const place = await newPlace(orgA);
    const photoId = await photo(place, orgA);
    const collection = await newCollection(orgA, [place], false);

    await setCollectionCover(asActor(curA), collection.id, { placePhotoId: photoId }, deps);

    expect(
      await asGuest(`select id from public.collections where id = ?`, [collection.id]),
    ).toEqual([]);
  });
});
