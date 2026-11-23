import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import {
  getPublishedCollection,
  getPublishedPlace,
  listNearbyCandidates,
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

// E1, PR4: what a guest reads on /collections/[slug] and /places/[placeId].
// The use cases run in the guest context on a pool of one connection as
// krajozbior_app, so a context leaked from a curator transaction would show.
// Every case where the content is not public must give the same `not_found`
// as an address that never existed.
let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("cur-a");
const curB = user("cur-b");

let orgA = "";
let orgB = "";

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
  runInUserContext(app.em, actor, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));

const deps: CatalogDeps = {
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
};

let counter = 0;

const newCollection = async (actor: { id: string }, organizationId: string, title: string) => {
  const slug = `publiczna-${(counter += 1)}`;
  const id = (
    await as(
      actor,
      `insert into public.collections (slug, organization_id, title, summary, region)
       values (?, ?, ?, 'Opis kolekcji', 'pomorskie') returning id`,
      [slug, organizationId, title],
    )
  )[0]!.id as string;

  return { id, slug };
};

const newPlace = async (actor: { id: string }, organizationId: string, name: string) =>
  (
    await as(
      actor,
      `insert into public.places (organization_id, name, description, address, access_info, latitude, longitude)
       values (?, ?, 'Opis miejsca', 'Tczew', 'Wejście od rynku', 54.0928, 18.7919) returning id`,
      [organizationId, name],
    )
  )[0]!.id as string;

const link = (
  actor: { id: string },
  collectionId: string,
  placeId: string,
  organizationId: string,
  position: number,
) =>
  as(
    actor,
    `insert into public.collection_places (collection_id, place_id, organization_id, position)
     values (?, ?, ?, ?)`,
    [collectionId, placeId, organizationId, position],
  );

const publish = (actor: { id: string }, collectionId: string) =>
  as(actor, `update public.collections set status = 'published' where id = ? returning id`, [
    collectionId,
  ]);

const unpublish = (actor: { id: string }, collectionId: string) =>
  as(actor, `update public.collections set status = 'draft' where id = ? returning id`, [
    collectionId,
  ]);

const missingSlug = "nie-ma-takiej-kolekcji-aaaaaa";
const missingId = "11111111-1111-4111-8111-111111111111";

describe("public read of collections and places (guest context)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_public_read");
    await db.migrate();

    for (const { id, email } of [curA, curB]) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }

    const org = async (name: string, slug: string, member: { id: string }) => {
      const [{ id }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ($1, $2, 'municipality') returning id`,
        [name, slug],
      );

      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [id, member.id],
      );

      return id;
    };

    orgA = await org("Gmina A", "gmina-a", curA);
    orgB = await org("Gmina B", "gmina-b", curB);

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("gives a guest only the public fields of a published collection and its places in order", async () => {
    const collection = await newCollection(curA, orgA, "Publiczna");
    const second = await newPlace(curA, orgA, "Drugie");
    const first = await newPlace(curA, orgA, "Pierwsze");

    await link(curA, collection.id, second, orgA, 2);
    await link(curA, collection.id, first, orgA, 1);
    await publish(curA, collection.id);

    const result = await getPublishedCollection(collection.slug, deps);

    expect(result).toEqual({
      status: "ok",
      value: {
        id: collection.id,
        slug: collection.slug,
        title: "Publiczna",
        summary: "Opis kolekcji",
        region: "pomorskie",
        organization: { name: "Gmina A", slug: "gmina-a" },
        places: [
          {
            id: first,
            name: "Pierwsze",
            address: "Tczew",
            position: 1,
            latitude: 54.0928,
            longitude: 18.7919,
            thumb: null,
          },
          {
            id: second,
            name: "Drugie",
            address: "Tczew",
            position: 2,
            latitude: 54.0928,
            longitude: 18.7919,
            thumb: null,
          },
        ],
        placeCount: 2,
        contentUpdatedAt: expect.any(Date),
        cover: null,
      },
    });

    const place = await getPublishedPlace(first, deps);

    expect(place).toEqual({
      status: "ok",
      value: {
        id: first,
        name: "Pierwsze",
        description: "Opis miejsca",
        address: "Tczew",
        accessInfo: "Wejście od rynku",
        accessRestriction: "none",
        latitude: 54.0928,
        longitude: 18.7919,
        visitRadiusM: 200,
        organization: { name: "Gmina A", slug: "gmina-a" },
        collections: [
          {
            id: collection.id,
            slug: collection.slug,
            title: "Publiczna",
            region: "pomorskie",
            position: 1,
            placeCount: 2,
            contentUpdatedAt: expect.any(Date),
            cover: null,
          },
        ],
        source: null,
        cover: null,
      },
    });
  });

  it("answers a draft, a draft's place and a missing address with the same not_found", async () => {
    const draft = await newCollection(curA, orgA, "Tajny szkic");
    const place = await newPlace(curA, orgA, "Miejsce ze szkicu");

    await link(curA, draft.id, place, orgA, 1);

    expect(await getPublishedCollection(draft.slug, deps)).toEqual({ status: "not_found" });
    expect(await getPublishedCollection(draft.slug, deps)).toEqual(
      await getPublishedCollection(missingSlug, deps),
    );
    expect(await getPublishedPlace(place, deps)).toEqual({ status: "not_found" });
    expect(await getPublishedPlace(place, deps)).toEqual(await getPublishedPlace(missingId, deps));

    // A place that is in no collection at all is not public either.
    const loose = await newPlace(curA, orgA, "Luźne miejsce");

    expect(await getPublishedPlace(loose, deps)).toEqual({ status: "not_found" });
  });

  it("lists only the published collections of a place that is also in a draft", async () => {
    const published = await newCollection(curA, orgA, "Opublikowana");
    const draft = await newCollection(curA, orgA, "Szkic z tym samym miejscem");
    const place = await newPlace(curA, orgA, "Wspólne");

    await link(curA, published.id, place, orgA, 1);
    await link(curA, draft.id, place, orgA, 1);
    await publish(curA, published.id);

    const result = await getPublishedPlace(place, deps);

    expect(result).toMatchObject({
      status: "ok",
      value: {
        collections: [{ id: published.id, slug: published.slug, title: "Opublikowana" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("Szkic z tym samym miejscem");
  });

  it("gives the card of a collection the first photo of its places as the cover, never a hidden one", async () => {
    const collection = await newCollection(curA, orgA, "Z okładką");
    const first = await newPlace(curA, orgA, "Bez zdjęcia");
    const second = await newPlace(curA, orgA, "Ze zdjęciem");

    await link(curA, collection.id, first, orgA, 1);
    await link(curA, collection.id, second, orgA, 2);
    await publish(curA, collection.id);

    const withoutPhoto = await getPublishedPlace(second, deps);

    expect(withoutPhoto).toMatchObject({ value: { collections: [{ cover: null }] } });

    const photoId = (
      await admin$<{ id: string }>(
        `insert into public.place_photos
           (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
            source_kind, title, author_text, source_url, license_code, license_url, license_label,
            rights_statement, commons_file)
         values ($1, $2, 1, 'ready', $3, 1280, 853, 'Opis zdjęcia', 'commons_import', 'Tytuł',
                 'Autor', 'https://commons.wikimedia.org/wiki/File:X.jpg', 'cc-by-sa-4.0',
                 'https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0',
                 'commons-import/1', 'Plik.jpg')
         returning id`,
        [orgA, second, randomUUID()],
      )
    )[0]!.id;

    // Seen from the other place of the same collection too: the card is the collection's.
    for (const placeId of [first, second]) {
      expect(await getPublishedPlace(placeId, deps)).toMatchObject({
        value: {
          collections: [
            {
              position: placeId === first ? 1 : 2,
              placeCount: 2,
              cover: { photoId, width: 1280, height: 853, altText: "Opis zdjęcia" },
            },
          ],
        },
      });
    }
  });

  describe("the cover and the number on the card of a collection of a place", () => {
    const addPhoto = async (placeId: string, position = 1) =>
      (
        await admin$<{ id: string }>(
          `insert into public.place_photos
             (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
              source_kind, title, author_text, source_url, license_code, license_url, license_label,
              rights_statement, commons_file)
           values ($1, $2, $3, 'ready', $4, 1280, 853, 'Opis zdjęcia', 'commons_import', 'Tytuł',
                   'Autor', 'https://commons.wikimedia.org/wiki/File:X.jpg', 'cc-by-sa-4.0',
                   'https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0',
                   'commons-import/1', 'Plik.jpg')
           returning id`,
          [orgA, placeId, position, randomUUID()],
        )
      )[0]!.id;

    const coverOf = async (placeId: string) => {
      const result = await getPublishedPlace(placeId, deps);

      if (result.status !== "ok") {
        throw new Error("place not readable");
      }

      return result.value.collections[0]!.cover?.photoId ?? null;
    };

    it("skips a hidden photo of the first place and takes the photo of the second", async () => {
      const collection = await newCollection(curA, orgA, "Okładka z ukrytym");
      const first = await newPlace(curA, orgA, "Pierwsze z ukrytym");
      const second = await newPlace(curA, orgA, "Drugie ze zdjęciem");

      await link(curA, collection.id, first, orgA, 1);
      await link(curA, collection.id, second, orgA, 2);
      await publish(curA, collection.id);

      const hidden = await addPhoto(first);
      const visible = await addPhoto(second);

      await admin$(`update public.place_photos set hidden_at = now() where id = $1`, [hidden]);

      expect(await coverOf(second)).toBe(visible);
    });

    it("does not take the cover from a place that is in another collection only", async () => {
      const collection = await newCollection(curA, orgA, "Okładka własna");
      const other = await newCollection(curA, orgA, "Inna kolekcja");
      const mine = await newPlace(curA, orgA, "Moje miejsce");
      const foreign = await newPlace(curA, orgA, "Miejsce z innej kolekcji");

      await link(curA, collection.id, mine, orgA, 5);
      await link(curA, other.id, foreign, orgA, 1);
      await publish(curA, collection.id);
      await publish(curA, other.id);
      await addPhoto(foreign);

      expect(await coverOf(mine)).toBeNull();

      const own = await addPhoto(mine);

      expect(await coverOf(mine)).toBe(own);
    });

    it("takes the photo the curator chose instead of the first one", async () => {
      const collection = await newCollection(curA, orgA, "Okładka wybrana");
      const first = await newPlace(curA, orgA, "Pierwsze wybrane");
      const second = await newPlace(curA, orgA, "Drugie wybrane");

      await link(curA, collection.id, first, orgA, 1);
      await link(curA, collection.id, second, orgA, 2);
      await publish(curA, collection.id);
      await addPhoto(first);

      const chosen = await addPhoto(second);

      await admin$(`update public.collections set cover_place_photo_id = $1 where id = $2`, [
        chosen,
        collection.id,
      ]);

      expect(await coverOf(first)).toBe(chosen);
    });

    // Today a hidden choice of the curator gives no cover at all; it should fall back to the
    // automatic photo. Fixed after #129 (the shared collectionCoverLateral).
    it.todo("falls back to the automatic photo when the chosen one is hidden (after #129)");

    it("numbers the place in its collection in sequence, also after a gap in positions", async () => {
      const collection = await newCollection(curA, orgA, "Z dziurą w pozycjach");
      const a = await newPlace(curA, orgA, "Miejsce A");
      const b = await newPlace(curA, orgA, "Miejsce B");
      const c = await newPlace(curA, orgA, "Miejsce C");

      // Positions 1, 4 and 9: the places in between were removed.
      await link(curA, collection.id, a, orgA, 1);
      await link(curA, collection.id, b, orgA, 4);
      await link(curA, collection.id, c, orgA, 9);
      await publish(curA, collection.id);

      for (const [place, number] of [
        [a, 1],
        [b, 2],
        [c, 3],
      ] as const) {
        expect(await getPublishedPlace(place, deps)).toMatchObject({
          value: { collections: [{ position: number, placeCount: 3 }] },
        });
      }
    });
  });

  it("hides a withdrawn collection and shows it again after it is published once more", async () => {
    const collection = await newCollection(curA, orgA, "Wycofywana");
    const place = await newPlace(curA, orgA, "Miejsce wycofywanej");

    await link(curA, collection.id, place, orgA, 1);
    await publish(curA, collection.id);
    expect(await getPublishedCollection(collection.slug, deps)).toMatchObject({ status: "ok" });

    await unpublish(curA, collection.id);
    expect(await getPublishedCollection(collection.slug, deps)).toEqual({ status: "not_found" });
    expect(await getPublishedPlace(place, deps)).toEqual({ status: "not_found" });

    await publish(curA, collection.id);
    expect(await getPublishedCollection(collection.slug, deps)).toMatchObject({ status: "ok" });
    expect(await getPublishedPlace(place, deps)).toMatchObject({ status: "ok" });
  });

  it("hides the content of an organization that is not approved", async () => {
    const collection = await newCollection(curB, orgB, "Organizacji B");
    const place = await newPlace(curB, orgB, "Miejsce organizacji B");

    await link(curB, collection.id, place, orgB, 1);
    await publish(curB, collection.id);
    expect(await getPublishedCollection(collection.slug, deps)).toMatchObject({ status: "ok" });

    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgB]);
    expect(await getPublishedCollection(collection.slug, deps)).toEqual({ status: "not_found" });
    expect(await getPublishedPlace(place, deps)).toEqual({ status: "not_found" });

    await admin$(`update public.organizations set status = 'approved' where id = $1`, [orgB]);
  });

  it("does not take the identity of a curator who read just before on the same connection", async () => {
    const draft = await newCollection(curA, orgA, "Szkic po kuratorze");
    const place = await newPlace(curA, orgA, "Miejsce po kuratorze");

    await link(curA, draft.id, place, orgA, 1);

    // The curator sees the own draft ...
    expect(
      await as(curA, `select id from public.collections where id = ?`, [draft.id]),
    ).toHaveLength(1);
    // ... and the very next guest read on the single connection does not.
    expect(await getPublishedCollection(draft.slug, deps)).toEqual({ status: "not_found" });
    expect(await getPublishedPlace(place, deps)).toEqual({ status: "not_found" });
  });

  it("opens only a read-only transaction for a guest", async () => {
    await expect(
      runInGuestContext(app.em, ({ em }) =>
        em.execute(
          `insert into public.collections (slug, organization_id, title, region)
           values ('zapis-goscia', ?, 'x', 'pomorskie')`,
          [orgA],
        ),
      ),
    ).rejects.toThrow(/read-only transaction/);
    expect(
      await admin$(`select 1 from public.collections where slug = 'zapis-goscia'`),
    ).toHaveLength(0);
  });

  it("rejects an address that is not a slug or a UUID without touching the database", async () => {
    expect(await getPublishedCollection("Zły Slug", deps)).toEqual({ status: "not_found" });
    expect(await getPublishedCollection("a".repeat(81), deps)).toEqual({ status: "not_found" });
    expect(await getPublishedPlace("not-a-uuid", deps)).toEqual({ status: "not_found" });
  });

  // E12-1 (own block of this PR): the list "Kolekcje do odkrycia" on the home page.
  it("lists for the home page only published collections of approved organizations, with the number of their places", async () => {
    const draft = await newCollection(curB, orgB, "Szkic strony głównej");
    const draftPlace = await newPlace(curB, orgB, "Miejsce szkicu strony głównej");
    const open = await newCollection(curB, orgB, "Publiczna strony głównej");

    await link(curB, draft.id, draftPlace, orgB, 1);
    await link(curB, open.id, await newPlace(curB, orgB, "Miejsce publiczne 1"), orgB, 1);
    await link(curB, open.id, await newPlace(curB, orgB, "Miejsce publiczne 2"), orgB, 2);
    await publish(curB, open.id);

    const list = await listRecentlyPublishedCollections(200, deps);

    expect(list.map((collection) => collection.id)).toContain(open.id);
    expect(list.map((collection) => collection.id)).not.toContain(draft.id);
    expect(list.find((collection) => collection.id === open.id)).toEqual({
      id: open.id,
      slug: open.slug,
      title: "Publiczna strony głównej",
      region: "pomorskie",
      organization: { name: "Gmina B" },
      placeCount: 2,
      cover: null,
    });
    // The fields are public ones only: no organization id, no version, no status.
    expect(Object.keys(list[0]!).sort()).toEqual([
      "cover",
      "id",
      "organization",
      "placeCount",
      "region",
      "slug",
      "title",
    ]);
  });

  // E12-4 (own block of this PR): the number of places and the date of the last change in the
  // header of the collection page. Both are read in the guest context, from the same rows as the
  // list of places, so they say nothing about what a guest cannot see.
  describe("E12-4: place count and date of the last change of a published collection", () => {
    const at = (iso: string) => new Date(iso);
    const setTimes = async (sql: string, params: unknown[]) => admin$(sql, params);

    it("counts the places and takes the latest of: the collection, an added place, a changed place", async () => {
      const collection = await newCollection(curA, orgA, "Album z datą");
      const one = await newPlace(curA, orgA, "Album 1");
      const two = await newPlace(curA, orgA, "Album 2");

      await link(curA, collection.id, one, orgA, 1);
      await link(curA, collection.id, two, orgA, 2);
      await publish(curA, collection.id);
      await setTimes(`update public.collections set updated_at = $2 where id = $1`, [
        collection.id,
        at("2026-01-10T10:00:00Z"),
      ]);
      await setTimes(
        `update public.collection_places set added_at = $3 where collection_id = $1 and place_id = $2`,
        [collection.id, one, at("2026-02-10T10:00:00Z")],
      );
      await setTimes(
        `update public.collection_places set added_at = $3 where collection_id = $1 and place_id = $2`,
        [collection.id, two, at("2026-02-01T10:00:00Z")],
      );
      await setTimes(`update public.places set updated_at = $2 where id = $1`, [
        one,
        at("2026-01-20T10:00:00Z"),
      ]);
      await setTimes(`update public.places set updated_at = $2 where id = $1`, [
        two,
        at("2026-01-25T10:00:00Z"),
      ]);

      // The latest is the addition of place 1 (10 February).
      let result = await getPublishedCollection(collection.slug, deps);

      expect(result.status === "ok" && result.value.placeCount).toBe(2);
      expect(result.status === "ok" && result.value.contentUpdatedAt).toEqual(
        at("2026-02-10T10:00:00Z"),
      );

      // A change of a place later than all of it moves the date.
      await setTimes(`update public.places set updated_at = $2 where id = $1`, [
        two,
        at("2026-03-05T08:30:15.123Z"),
      ]);
      result = await getPublishedCollection(collection.slug, deps);
      expect(result.status === "ok" && result.value.contentUpdatedAt).toEqual(
        at("2026-03-05T08:30:15.123Z"),
      );

      // A change of the collection later than everything moves it too.
      await setTimes(`update public.collections set updated_at = $2 where id = $1`, [
        collection.id,
        at("2026-04-01T00:00:00Z"),
      ]);
      result = await getPublishedCollection(collection.slug, deps);
      expect(result.status === "ok" && result.value.contentUpdatedAt).toEqual(
        at("2026-04-01T00:00:00Z"),
      );
    });

    it("does not move the date with a place that was removed from the collection, or with one that was never in it", async () => {
      const collection = await newCollection(curA, orgA, "Album bez cudzych zmian");
      const kept = await newPlace(curA, orgA, "Zostaje");
      const removed = await newPlace(curA, orgA, "Usunięte");
      const outside = await newPlace(curA, orgA, "Poza kolekcją");

      await link(curA, collection.id, kept, orgA, 1);
      await link(curA, collection.id, removed, orgA, 2);
      await publish(curA, collection.id);
      await as(
        curA,
        `delete from public.collection_places where collection_id = ? and place_id = ?`,
        [collection.id, removed],
      );
      await setTimes(`update public.collections set updated_at = $2 where id = $1`, [
        collection.id,
        at("2026-01-01T00:00:00Z"),
      ]);
      await setTimes(`update public.collection_places set added_at = $2 where collection_id = $1`, [
        collection.id,
        at("2026-01-02T00:00:00Z"),
      ]);
      await setTimes(`update public.places set updated_at = $2 where id = $1`, [
        kept,
        at("2026-01-03T00:00:00Z"),
      ]);
      await setTimes(`update public.places set updated_at = $2 where id = any($1::uuid[])`, [
        [removed, outside],
        at("2026-09-09T00:00:00Z"),
      ]);

      const result = await getPublishedCollection(collection.slug, deps);

      expect(result.status === "ok" && result.value.placeCount).toBe(1);
      expect(result.status === "ok" && result.value.contentUpdatedAt).toEqual(
        at("2026-01-03T00:00:00Z"),
      );
    });

    it("gives a collection without places the count 0 and the date of the collection", async () => {
      const collection = await newCollection(curA, orgA, "Album pusty");

      await publish(curA, collection.id);
      await setTimes(`update public.collections set updated_at = $2 where id = $1`, [
        collection.id,
        at("2026-05-05T05:05:05Z"),
      ]);

      const result = await getPublishedCollection(collection.slug, deps);

      expect(result.status === "ok" && result.value.placeCount).toBe(0);
      expect(result.status === "ok" && result.value.contentUpdatedAt).toEqual(
        at("2026-05-05T05:05:05Z"),
      );
    });

    it("says nothing about a draft, a withdrawn collection or one of a suspended organization, even to its curator", async () => {
      const draft = await newCollection(curA, orgA, "Album szkic");
      const withdrawn = await newCollection(curA, orgA, "Album wycofany");
      const place = await newPlace(curA, orgA, "Miejsce wycofanego");

      await link(curA, draft.id, place, orgA, 1);
      await link(curA, withdrawn.id, place, orgA, 1);
      await publish(curA, withdrawn.id);
      await unpublish(curA, withdrawn.id);

      // The curator is signed in somewhere else: the read still runs as a guest.
      expect(await getPublishedCollection(draft.slug, deps)).toEqual({ status: "not_found" });
      expect(await getPublishedCollection(withdrawn.slug, deps)).toEqual({ status: "not_found" });

      const suspended = await newCollection(curA, orgA, "Album zawieszonej organizacji");

      await link(curA, suspended.id, place, orgA, 1);
      await publish(curA, suspended.id);
      await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgA]);
      try {
        expect(await getPublishedCollection(suspended.slug, deps)).toEqual({ status: "not_found" });
      } finally {
        await admin$(`update public.organizations set status = 'approved' where id = $1`, [orgA]);
      }
    });

    it("counts only the places the guest lists: a place of a draft shared with a published collection counts once and shows nothing of the draft", async () => {
      const published = await newCollection(curB, orgB, "Album współdzielony");
      const draft = await newCollection(curB, orgB, "Szkic współdzielony");
      const shared = await newPlace(curB, orgB, "Wspólne");
      const onlyDraft = await newPlace(curB, orgB, "Tylko w szkicu");

      await link(curB, published.id, shared, orgB, 1);
      await link(curB, draft.id, shared, orgB, 1);
      await link(curB, draft.id, onlyDraft, orgB, 2);
      await publish(curB, published.id);

      const result = await getPublishedCollection(published.slug, deps);

      expect(result.status).toBe("ok");
      expect(result.status === "ok" && result.value.placeCount).toBe(1);
      expect(result.status === "ok" && result.value.places.map((place) => place.id)).toEqual([
        shared,
      ]);
      // Public fields only: the new ones are the number and the date, nothing of the draft.
      expect(result.status === "ok" ? Object.keys(result.value).sort() : []).toEqual([
        "contentUpdatedAt",
        "cover",
        "id",
        "organization",
        "placeCount",
        "places",
        "region",
        "slug",
        "summary",
        "title",
      ]);
    });
  });

  // E12-3 (own block of this PR): the public list for "W okolicy" with the centre of the places.
  describe("list for W okolicy (E12-3)", () => {
    const placeAt = async (
      actor: { id: string },
      organizationId: string,
      name: string,
      latitude: number,
      longitude: number,
    ) =>
      (
        await as(
          actor,
          `insert into public.places (organization_id, name, description, address, access_info, latitude, longitude)
           values (?, ?, 'Opis', 'Adres', 'Dostęp', ?, ?) returning id`,
          [organizationId, name, latitude, longitude],
        )
      )[0]!.id as string;

    it("gives the centre and the number of the places of a published collection, public fields only", async () => {
      const open = await newCollection(curB, orgB, "W okolicy: publiczna");

      await link(curB, open.id, await placeAt(curB, orgB, "Okolica 1", 54, 18), orgB, 1);
      await link(curB, open.id, await placeAt(curB, orgB, "Okolica 2", 54.2, 18.4), orgB, 2);
      await publish(curB, open.id);

      const found = (await listNearbyCandidates(deps)).find((entry) => entry.slug === open.slug);

      expect(found).toMatchObject({
        slug: open.slug,
        title: "W okolicy: publiczna",
        region: "pomorskie",
        placeCount: 2,
      });
      expect(found!.centerLat).toBeCloseTo(54.1, 9);
      expect(found!.centerLon).toBeCloseTo(18.2, 9);
      expect(typeof found!.firstPublishedAt).toBe("string");
      expect(Object.keys(found!).sort()).toEqual([
        "centerLat",
        "centerLon",
        "firstPublishedAt",
        "placeCount",
        "region",
        "slug",
        "title",
      ]);
    });

    it("leaves out a draft, a withdrawn collection and one of a suspended organization, also for its curator", async () => {
      const draft = await newCollection(curB, orgB, "W okolicy: szkic");
      const withdrawn = await newCollection(curB, orgB, "W okolicy: wycofana");
      const suspended = await newCollection(curA, orgA, "W okolicy: zawieszona");

      await link(curB, draft.id, await placeAt(curB, orgB, "Miejsce szkicu", 54, 18), orgB, 1);
      await link(
        curB,
        withdrawn.id,
        await placeAt(curB, orgB, "Miejsce wycofanej", 54, 18),
        orgB,
        1,
      );
      await link(
        curA,
        suspended.id,
        await placeAt(curA, orgA, "Miejsce zawieszonej", 54, 18),
        orgA,
        1,
      );
      await publish(curB, withdrawn.id);
      await unpublish(curB, withdrawn.id);
      await publish(curA, suspended.id);
      await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgA]);

      try {
        // The owners can read their own non-public collections ...
        expect(
          await as(curB, `select id from public.collections where id in (?, ?)`, [
            draft.id,
            withdrawn.id,
          ]),
        ).toHaveLength(2);

        // ... and the public list still has none of them.
        const slugs = (await listNearbyCandidates(deps)).map((entry) => entry.slug);

        expect(slugs).not.toContain(draft.slug);
        expect(slugs).not.toContain(withdrawn.slug);
        expect(slugs).not.toContain(suspended.slug);
      } finally {
        await admin$(`update public.organizations set status = 'approved' where id = $1`, [orgA]);
      }
    });

    it("counts only the places of the collection itself, also when one lies in a draft too", async () => {
      const open = await newCollection(curB, orgB, "W okolicy: wspólne miejsce");
      const draft = await newCollection(curB, orgB, "W okolicy: szkic ze wspólnym");
      const shared = await placeAt(curB, orgB, "Wspólne", 54, 18);
      const far = await placeAt(curB, orgB, "Tylko w szkicu", 10, 10);

      await link(curB, open.id, shared, orgB, 1);
      await link(curB, draft.id, shared, orgB, 1);
      await link(curB, draft.id, far, orgB, 2);
      await publish(curB, open.id);

      const list = await listNearbyCandidates(deps);
      const found = list.find((entry) => entry.slug === open.slug);

      expect(found).toMatchObject({ placeCount: 1, centerLat: 54, centerLon: 18 });
      expect(list.map((entry) => entry.slug)).not.toContain(draft.slug);
    });

    it("leaves out a published collection that has no place", async () => {
      const empty = await newCollection(curB, orgB, "W okolicy: pusta");

      // A collection may be published without a place by the owner of the database only; the
      // list must not break on it (no centre, so no entry).
      await admin$(
        `update public.collections set status = 'published', published_at = now(), first_published_at = now() where id = $1`,
        [empty.id],
      );

      expect((await listNearbyCandidates(deps)).map((entry) => entry.slug)).not.toContain(
        empty.slug,
      );
    });
  });

  // E12-5 (own block of this PR): the map needs the coordinates of the places of a published
  // collection; the guest read must give them for those places and for no other.
  describe("coordinates of the places for the collection map (E12-5)", () => {
    it("gives the coordinates of the places of a published collection and no place of a draft", async () => {
      const open = await newCollection(curA, orgA, "Mapa: publiczna");
      const draft = await newCollection(curA, orgA, "Mapa: szkic");
      const inOpen = await newPlace(curA, orgA, "Mapa: w publicznej");
      const onlyInDraft = await newPlace(curA, orgA, "Mapa: tylko w szkicu");

      await link(curA, open.id, inOpen, orgA, 1);
      await link(curA, draft.id, onlyInDraft, orgA, 1);
      await publish(curA, open.id);

      const result = await getPublishedCollection(open.slug, deps);

      expect(result).toMatchObject({
        status: "ok",
        value: { places: [{ id: inOpen, latitude: 54.0928, longitude: 18.7919 }] },
      });
      expect(JSON.stringify(result)).not.toContain(onlyInDraft);
      expect(await getPublishedCollection(draft.slug, deps)).toEqual({ status: "not_found" });
    });

    it("gives no coordinates of a withdrawn collection", async () => {
      const withdrawn = await newCollection(curA, orgA, "Mapa: wycofana");
      const place = await newPlace(curA, orgA, "Mapa: w wycofanej");

      await link(curA, withdrawn.id, place, orgA, 1);
      await publish(curA, withdrawn.id);
      expect(await getPublishedCollection(withdrawn.slug, deps)).toMatchObject({ status: "ok" });

      await unpublish(curA, withdrawn.id);

      const result = await getPublishedCollection(withdrawn.slug, deps);

      expect(result).toEqual({ status: "not_found" });
      expect(JSON.stringify(result)).not.toContain(place);
    });
  });
});
