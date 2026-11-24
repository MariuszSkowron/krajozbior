import { randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NewsReadDeps } from "@/features/news/application/news-read-types";
import { getPublicNews, listPublicNews } from "@/features/news/application/public-news";
import { postgresNewsReadRepository } from "@/features/news/infrastructure/postgres-news-read-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// The public reading of news (E7-R3, spec E7 14.5) on the real database, as krajozbior_app:
// a guest reads published items of approved organizations and nothing else, and the links to
// a collection and a place appear only when those are public too. A signed-in curator gets the
// same through the same use cases (the pages always read in the guest context), and even a
// direct read in the context of the curator shows no draft, which is the policy of the table.
let db: ScratchDatabase;
let app: MikroORM;

const curator = { id: randomUUID(), email: "cur-news-read@example.com" };

let orgTeam = ""; // the editorial organization, approved
let orgOther = ""; // approved
let orgSuspended = "";

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

const guestDeps: NewsReadDeps = {
  withGuestContext: (work) => runInGuestContext(app.em, work),
  repository: postgresNewsReadRepository,
};
const curatorDeps: NewsReadDeps = {
  withGuestContext: (work) => runInUserContext(app.em, curator, work),
  repository: postgresNewsReadRepository,
};

let counter = 0;
const next = () => (counter += 1);

type Put = {
  organizationId: string;
  slug: string;
  kind?: string;
  title: string;
  body?: string;
  collectionId?: string | null;
  placeId?: string | null;
  eventStartsOn?: string | null;
  eventEndsOn?: string | null;
  status?: string;
};

// The one writer, as krajozbior_ops; a withdrawn item is a published one that is then withdrawn.
async function put(v: Put): Promise<string> {
  const id = randomUUID();

  await withClient(db.urls.krajozbior_ops, async (client) => {
    const write = (status: string) =>
      client.query(
        `select put_result from public.ops_put_news($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id,
          v.organizationId,
          v.slug,
          v.kind ?? "guide",
          v.title,
          "Krótki tekst aktualności.",
          v.body ?? "",
          v.collectionId ?? null,
          v.placeId ?? null,
          v.eventStartsOn ?? null,
          v.eventEndsOn ?? null,
          status,
        ],
      );
    const status = v.status ?? "published";

    if (status === "withdrawn") {
      await write("published");
    }
    await write(status);
  });

  return id;
}

const title = (label: string) => `Aktualność ${label} ${next()}`;

async function newPlace(organizationId: string, name: string): Promise<string> {
  return (
    await admin$<{ id: string }>(
      `insert into public.places (organization_id, name, latitude, longitude)
       values ($1, $2, 54.1, 18.7) returning id`,
      [organizationId, name],
    )
  )[0]!.id;
}

async function newCollection(
  organizationId: string,
  name: string,
  placeIds: string[],
  status: "draft" | "published",
): Promise<{ id: string; slug: string }> {
  const slug = `kolekcja-news-read-${next()}`;
  const id = (
    await admin$<{ id: string }>(
      `insert into public.collections (slug, organization_id, title, region)
       values ($1, $2, $3, 'pomorskie') returning id`,
      [slug, organizationId, name],
    )
  )[0]!.id;

  for (const [index, placeId] of placeIds.entries()) {
    await admin$(
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values ($1, $2, $3, $4)`,
      [id, placeId, organizationId, index + 1],
    );
  }

  if (status === "published") {
    await admin$(
      `update public.collections set status = 'published', published_at = now(),
              first_published_at = now() where id = $1`,
      [id],
    );
  }

  return { id, slug };
}

describe("public reading of news (E7-R3)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_news_public_read");
    await db.migrate();

    await admin$(`insert into auth.users (id, name, email) values ($1, 'cur', $2)`, [
      curator.id,
      curator.email,
    ]);

    const org = async (name: string, slug: string) =>
      (
        await admin$<{ id: string }>(
          `insert into public.organizations (name, slug, kind) values ($1, $2, 'municipality') returning id`,
          [name, slug],
        )
      )[0]!.id;

    orgTeam = await org("Krajozbiór — redakcja", "krajozbior-redakcja");
    orgOther = await org("Gmina Czytelna", "gmina-czytelna-news");
    orgSuspended = await org("Gmina Zawieszona", "gmina-zawieszona-news");
    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [orgTeam, curator.id],
    );

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  describe("the list", () => {
    it("shows published items of approved organizations, newest first, and no draft, withdrawn or suspended item", async () => {
      const first = await put({
        organizationId: orgTeam,
        slug: `lista-${next()}`,
        title: title("pierwsza"),
      });
      const second = await put({
        organizationId: orgOther,
        slug: `lista-${next()}`,
        title: title("druga"),
      });
      const draft = await put({
        organizationId: orgTeam,
        slug: `lista-szkic-${next()}`,
        title: title("szkic"),
        status: "draft",
      });
      const withdrawn = await put({
        organizationId: orgTeam,
        slug: `lista-wycofana-${next()}`,
        title: title("wycofana"),
        status: "withdrawn",
      });
      const hidden = await put({
        organizationId: orgSuspended,
        slug: `lista-zawieszona-${next()}`,
        title: title("zawieszona"),
      });

      // The trigger sets the moment of publication; each `put` is its own transaction, so the
      // second item is newer than the first.
      await admin$(`update public.organizations set status = 'suspended' where id = $1`, [
        orgSuspended,
      ]);

      const cards = await listPublicNews(null, guestDeps);
      const slugs = cards.map((card) => card.slug);
      const slugOf = async (id: string) =>
        (
          await admin$<{ slug: string }>(`select slug from public.news_posts where id = $1`, [id])
        )[0]!.slug;

      expect(slugs).toContain(await slugOf(first));
      expect(slugs).toContain(await slugOf(second));
      expect(slugs).not.toContain(await slugOf(draft));
      expect(slugs).not.toContain(await slugOf(withdrawn));
      expect(slugs).not.toContain(await slugOf(hidden));
      expect(slugs.indexOf(await slugOf(second))).toBeLessThan(slugs.indexOf(await slugOf(first)));

      const card = cards.find((one) => one.slug === slugs[0])!;

      expect(Object.keys(card).sort()).toEqual(
        [
          "cover",
          "eventEndsOn",
          "eventStartsOn",
          "kind",
          "lead",
          "organization",
          "publishedAt",
          "slug",
          "title",
          "verification",
        ].sort(),
      );
      expect(card.publishedAt).toBeInstanceOf(Date);

      await admin$(`update public.organizations set status = 'approved' where id = $1`, [
        orgSuspended,
      ]);
      expect((await listPublicNews(null, guestDeps)).map((one) => one.slug)).toContain(
        await slugOf(hidden),
      );
    });

    it("marks the editorial team and another organization differently", async () => {
      const slugTeam = `znak-${next()}`;
      const slugOther = `znak-${next()}`;

      await put({ organizationId: orgTeam, slug: slugTeam, title: title("zespół") });
      await put({ organizationId: orgOther, slug: slugOther, title: title("organizacja") });

      const cards = await listPublicNews(null, guestDeps);

      expect(cards.find((card) => card.slug === slugTeam)?.verification).toBe("editorial");
      expect(cards.find((card) => card.slug === slugOther)?.verification).toBe("verified");
    });

    it("gives events as days without a zone, and the filter keeps the ones on or still to come", async () => {
      const future = `wyd-przyszle-${next()}`;
      const past = `wyd-minione-${next()}`;

      await put({
        organizationId: orgTeam,
        slug: future,
        kind: "event",
        title: title("przyszłe"),
        eventStartsOn: "2099-05-01",
        eventEndsOn: "2099-05-02",
      });
      await put({
        organizationId: orgTeam,
        slug: past,
        kind: "event",
        title: title("minione"),
        eventStartsOn: "2020-01-01",
      });

      const events = await listPublicNews("events", guestDeps);

      expect(events.find((card) => card.slug === future)).toMatchObject({
        eventStartsOn: "2099-05-01",
        eventEndsOn: "2099-05-02",
      });
      expect(events.map((card) => card.slug)).not.toContain(past);
      expect(events.every((card) => card.kind === "event")).toBe(true);
      expect((await listPublicNews(null, guestDeps)).map((card) => card.slug)).toContain(past);
    });
  });

  describe("one item", () => {
    it("returns a published item with its body and no draft, withdrawn or unknown address", async () => {
      const slug = `pozycja-${next()}`;

      await put({
        organizationId: orgTeam,
        slug,
        title: title("pozycja"),
        body: "Akapit.\n\nhttps://example.org",
      });

      expect(await getPublicNews(slug, guestDeps)).toMatchObject({
        status: "ok",
        value: {
          slug,
          body: "Akapit.\n\nhttps://example.org",
          contentUpdatedAt: null,
          collection: null,
          place: null,
        },
      });

      const draftSlug = `pozycja-szkic-${next()}`;
      const withdrawnSlug = `pozycja-wycofana-${next()}`;

      await put({
        organizationId: orgTeam,
        slug: draftSlug,
        title: title("szkic"),
        status: "draft",
      });
      await put({
        organizationId: orgTeam,
        slug: withdrawnSlug,
        title: title("wycofana"),
        status: "withdrawn",
      });

      for (const missing of [draftSlug, withdrawnSlug, "nie-ma-takiej", "Zły adres"]) {
        expect(await getPublicNews(missing, guestDeps)).toEqual({ status: "not_found" });
      }
    });

    it("hides an item of a suspended organization and shows it again after the approval", async () => {
      const slug = `pozycja-organizacja-${next()}`;

      await put({ organizationId: orgOther, slug, title: title("organizacja") });
      await admin$(`update public.organizations set status = 'suspended' where id = $1`, [
        orgOther,
      ]);
      expect(await getPublicNews(slug, guestDeps)).toEqual({ status: "not_found" });

      await admin$(`update public.organizations set status = 'approved' where id = $1`, [orgOther]);
      expect(await getPublicNews(slug, guestDeps)).toMatchObject({ status: "ok" });
    });

    it("returns an item that was withdrawn and published again under the same address, with the note of the update only for a change of content", async () => {
      const slug = `pozycja-wrot-${next()}`;
      const id = await put({
        organizationId: orgTeam,
        slug,
        title: title("wrót"),
        status: "withdrawn",
      });

      expect(await getPublicNews(slug, guestDeps)).toEqual({ status: "not_found" });

      await withClient(db.urls.krajozbior_ops, (client) =>
        client.query(
          `select put_result from public.ops_put_news($1, $2, null, 'guide', $3, 'Krótki tekst aktualności.', 'Nowa treść', null, null, null, null, 'published')`,
          [id, orgTeam, "Nowy tytuł wrótu"],
        ),
      );

      expect(await getPublicNews(slug, guestDeps)).toMatchObject({
        status: "ok",
        value: { title: "Nowy tytuł wrótu", body: "Nowa treść" },
      });
    });
  });

  describe("the links to a collection and a place", () => {
    it("gives only the public ones", async () => {
      const publicPlace = await newPlace(orgTeam, "Miejsce publiczne");
      const draftOnlyPlace = await newPlace(orgTeam, "Miejsce ze szkicu");
      const loosePlace = await newPlace(orgTeam, "Miejsce bez kolekcji");
      const published = await newCollection(
        orgTeam,
        "Kolekcja opublikowana",
        [publicPlace],
        "published",
      );
      const draft = await newCollection(orgTeam, "Kolekcja szkic", [draftOnlyPlace], "draft");

      const read = async (v: { collectionId?: string; placeId?: string }) => {
        const slug = `powiazania-${next()}`;

        await put({ organizationId: orgTeam, slug, title: title("powiązania"), ...v });

        const result = await getPublicNews(slug, guestDeps);

        if (result.status !== "ok") {
          throw new Error("expected a published item");
        }

        return result.value;
      };

      expect(await read({ collectionId: published.id, placeId: publicPlace })).toMatchObject({
        collection: { slug: published.slug, title: "Kolekcja opublikowana" },
        place: { id: publicPlace, name: "Miejsce publiczne" },
      });
      expect(await read({ collectionId: draft.id, placeId: draftOnlyPlace })).toMatchObject({
        collection: null,
        place: null,
      });
      expect(await read({ placeId: loosePlace })).toMatchObject({ place: null });

      // The collection goes back to a draft: the link disappears, the item stays.
      await admin$(`update public.collections set status = 'draft' where id = $1`, [published.id]);
      expect(await read({ collectionId: published.id, placeId: publicPlace })).toMatchObject({
        collection: null,
        place: null,
      });
    });
  });

  // The cover of an item (T-1, T-2 of the spec "aktualności ze zdjęciami"): inherited from the
  // linked place, else from the linked collection, and only when everyone may see the photo.
  // Everything is read as krajozbior_app in the guest context (`guestDeps`), so the policy
  // `place_photos_select` is the second barrier; the admin client only prepares the data.
  describe("the cover", () => {
    const photo = async (
      placeId: string,
      position: number,
      state: "ready" | "pending_fetch" = "ready",
      organizationId: string = orgTeam,
    ): Promise<string> =>
      (
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
            position,
            state,
            state === "ready" ? randomUUID() : null,
            state === "ready" ? 1280 : null,
            state === "ready" ? 853 : null,
            `Plik ${next()}.jpg`,
          ],
        )
      )[0]!.id;

    // Publishes an item with the given links and reads it as a guest, from the list and the page.
    const publish = async (v: {
      collectionId?: string;
      placeId?: string;
      organizationId?: string;
    }) => {
      const slug = `okladka-${next()}`;

      await put({ organizationId: orgTeam, slug, title: title("okładka"), ...v });

      return slug;
    };

    const readBack = async (slug: string) => {
      const page = await getPublicNews(slug, guestDeps);
      const list = (await listPublicNews(null, guestDeps)).find((card) => card.slug === slug);

      if (page.status !== "ok" || list === undefined) {
        throw new Error("expected a published item on the page and in the list");
      }

      return { page: page.value.cover, card: list.cover };
    };

    const read = async (v: { collectionId?: string; placeId?: string }) =>
      readBack(await publish(v));

    it("takes the photo of the place before the cover of the collection, with the credit only on the page", async () => {
      const place = await newPlace(orgTeam, "Miejsce ze zdjęciem");
      const other = await newPlace(orgTeam, "Inne miejsce");
      const placePhoto = await photo(place, 2);
      const firstPlacePhoto = await photo(place, 1);
      const collectionPhoto = await photo(other, 1);
      const collection = await newCollection(orgTeam, "Kolekcja", [other, place], "published");
      const result = await read({ collectionId: collection.id, placeId: place });

      expect(placePhoto).not.toBe(firstPlacePhoto);
      expect(result.card).toEqual({
        photoId: firstPlacePhoto,
        width: 1280,
        height: 853,
        altText: "Opis zdjęcia",
      });
      expect(result.page).toMatchObject({
        photoId: firstPlacePhoto,
        authorText: "Autor",
        licenseLabel: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        title: "Tytuł",
      });
      expect(result.page?.photoId).not.toBe(collectionPhoto);
      expect(result.card).not.toHaveProperty("authorText");
    });

    it("takes the chosen cover of a collection, else the first photo of its first place", async () => {
      const first = await newPlace(orgTeam, "Pierwsze");
      const second = await newPlace(orgTeam, "Drugie");
      const firstPhoto = await photo(first, 1);
      const secondPhoto = await photo(second, 1);
      const collection = await newCollection(orgTeam, "Kolekcja", [first, second], "published");

      expect((await read({ collectionId: collection.id })).card?.photoId).toBe(firstPhoto);

      await admin$(`update public.collections set cover_place_photo_id = $1 where id = $2`, [
        secondPhoto,
        collection.id,
      ]);

      const chosen = await read({ collectionId: collection.id });

      expect(chosen.card?.photoId).toBe(secondPhoto);
      expect(chosen.page?.photoId).toBe(secondPhoto);
    });

    it("gives no photo for a hidden or not ready photo, a place outside a public collection, a draft or withdrawn collection, or no link", async () => {
      const hiddenPlace = await newPlace(orgTeam, "Ukryte");
      const hidden = await photo(hiddenPlace, 1);
      const pendingPlace = await newPlace(orgTeam, "Niegotowe");

      await photo(pendingPlace, 1, "pending_fetch");

      const loosePlace = await newPlace(orgTeam, "Luźne");

      await photo(loosePlace, 1);

      const draftPlace = await newPlace(orgTeam, "Ze szkicu");

      await photo(draftPlace, 1);

      const withdrawnPlace = await newPlace(orgTeam, "Z wycofanej");

      await photo(withdrawnPlace, 1);

      await newCollection(orgTeam, "Publiczna", [hiddenPlace, pendingPlace], "published");

      const draft = await newCollection(orgTeam, "Szkic", [draftPlace], "draft");
      const withdrawn = await newCollection(orgTeam, "Wycofana", [withdrawnPlace], "published");

      // A withdrawn collection is a published one that went back to a draft (it keeps its
      // `first_published_at`).
      await admin$(`update public.collections set status = 'draft' where id = $1`, [withdrawn.id]);
      await admin$(`update public.place_photos set hidden_at = now() where id = $1`, [hidden]);

      const none = { page: null, card: null };

      expect(await read({ placeId: hiddenPlace })).toEqual(none);
      expect(await read({ placeId: pendingPlace })).toEqual(none);
      expect(await read({ placeId: loosePlace })).toEqual(none);
      // A collection that is not public: the cover is not read, even with a chosen photo.
      await admin$(`update public.collections set cover_place_photo_id = $1 where id = $2`, [
        (
          await admin$<{ id: string }>(`select id from public.place_photos where place_id = $1`, [
            draftPlace,
          ])
        )[0]!.id,
        draft.id,
      ]);
      expect(await read({ collectionId: draft.id })).toEqual(none);
      expect(await read({ collectionId: withdrawn.id })).toEqual(none);
      expect(await read({})).toEqual(none);
    });

    it("gives no photo while the organization of the collection and the place is suspended, and gives it back after the approval", async () => {
      const place = await newPlace(orgOther, "Miejsce zawieszonej");

      await photo(place, 1, "ready", orgOther);

      const collection = await newCollection(
        orgOther,
        "Kolekcja zawieszonej",
        [place],
        "published",
      );
      // The items are published while the organization is approved (the database refuses a link
      // to a collection or place of a suspended one), then the organization is suspended.
      const byPlace = await publish({ organizationId: orgOther, placeId: place });
      const byCollection = await publish({ organizationId: orgOther, collectionId: collection.id });
      const byBoth = await publish({
        organizationId: orgOther,
        collectionId: collection.id,
        placeId: place,
      });

      // Control: while the organization is approved the same links give a photo.
      expect((await readBack(byPlace)).card).not.toBeNull();
      expect((await readBack(byCollection)).card).not.toBeNull();

      await admin$(`update public.organizations set status = 'suspended' where id = $1`, [
        orgOther,
      ]);

      try {
        // The item and its photo of a suspended organization are gone from the page and the list.
        const list = await listPublicNews(null, guestDeps);

        for (const slug of [byPlace, byCollection, byBoth]) {
          expect((await getPublicNews(slug, guestDeps)).status).not.toBe("ok");
          expect(list.find((card) => card.slug === slug)).toBeUndefined();
        }
      } finally {
        await admin$(`update public.organizations set status = 'approved' where id = $1`, [
          orgOther,
        ]);
      }

      expect((await readBack(byPlace)).card).not.toBeNull();
    });

    it("drops the photo once its collection leaves the public list, and the item stays", async () => {
      const place = await newPlace(orgTeam, "Zniknie");

      await photo(place, 1);

      const collection = await newCollection(orgTeam, "Zniknie", [place], "published");
      const before = await read({ collectionId: collection.id });

      expect(before.card).not.toBeNull();

      await admin$(`update public.collections set status = 'draft' where id = $1`, [collection.id]);
      expect(await read({ collectionId: collection.id, placeId: place })).toEqual({
        page: null,
        card: null,
      });
    });

    it("returns the same photo on the list and on the page", async () => {
      const place = await newPlace(orgTeam, "To samo");

      await photo(place, 1);
      await newCollection(orgTeam, "Ta sama", [place], "published");

      const result = await read({ placeId: place });

      expect(result.card?.photoId).toBeDefined();
      expect(result.page?.photoId).toBe(result.card?.photoId);
    });
  });

  describe("signed-in readers", () => {
    it("gives a curator of the editorial organization the same list as a guest: no draft of the own organization", async () => {
      const draftSlug = `kurator-szkic-${next()}`;
      const publishedSlug = `kurator-opublikowana-${next()}`;

      await put({
        organizationId: orgTeam,
        slug: draftSlug,
        title: title("szkic"),
        status: "draft",
      });
      await put({ organizationId: orgTeam, slug: publishedSlug, title: title("opublikowana") });

      const asGuest = (await listPublicNews(null, guestDeps)).map((card) => card.slug);
      const asCurator = (await listPublicNews(null, curatorDeps)).map((card) => card.slug);

      expect(asCurator).toEqual(asGuest);
      expect(asCurator).toContain(publishedSlug);
      expect(asCurator).not.toContain(draftSlug);
      expect(await getPublicNews(draftSlug, curatorDeps)).toEqual({ status: "not_found" });
    });
  });

  it("reads inside a read-only transaction and cannot write", async () => {
    await expect(
      runInGuestContext(app.em, ({ em }) =>
        em.execute(`update public.news_posts set title = 'Zmieniony tytuł' where true`),
      ),
    ).rejects.toThrow(/read-only transaction|permission denied/);
  });
});
