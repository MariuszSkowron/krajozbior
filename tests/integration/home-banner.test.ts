import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { getHomeBanner } from "@/features/catalog/application/public-catalog";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// Pula banera strony głównej (R3, PR 4) na prawdziwej bazie, w kontekście gościa (`krajozbior_app`).
// Na baner trafia tylko miejsce z puli, które jest w opublikowanej kolekcji zatwierdzonej
// organizacji i ma gotowe, nieukryte zdjęcie (>= 1100 px, nie szersze niż 16:9).
let db: ScratchDatabase;
let app: MikroORM;
let orgA = "";
let orgB = "";
let counter = 0;

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

const deps: CatalogDeps = {
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
};

const focus = (n: number) => ({ wide: `${n}% 40%`, narrow: `${n}% 50%` });
const pool = (...qids: string[]) => qids.map((qid, index) => ({ qid, focus: focus(index + 1) }));

const place = async (organizationId: string, qid: string | null): Promise<string> => {
  const [{ id }] = await admin$<{ id: string }>(
    `insert into public.places (organization_id, name, latitude, longitude)
     values ($1, $2, 54.1, 18.7) returning id`,
    [organizationId, `Miejsce ${(counter += 1)}`],
  );

  if (qid !== null) {
    await admin$(
      `insert into public.place_sources
         (place_id, organization_id, wikidata_qid, description_method, attribution, retrieved_at)
       values ($1, $2, $3, 'facts_template', 'Wikidata (CC0)', now())`,
      [id, organizationId, qid],
    );
  }

  return id;
};

const photo = async (
  placeId: string,
  organizationId: string,
  options: { width?: number; height?: number; state?: "ready" | "pending_fetch" } = {},
): Promise<string> => {
  const { width = 1600, height = 1000, state = "ready" } = options;
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
        state === "ready" ? width : null,
        state === "ready" ? height : null,
        `Plik ${n}.jpg`,
      ],
    )
  )[0]!.id;
};

const collection = async (organizationId: string, placeIds: string[], published: boolean) => {
  const [{ id }] = await admin$<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, region, status)
     values ($1, $2, 'Kolekcja', 'pomorskie', 'draft') returning id`,
    [`kolekcja-${(counter += 1)}`, organizationId],
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

  return id;
};

// A place of the pool, published, with a good photo; the parts are changed by the tests.
const ready = async (qid: string, organizationId = orgA) => {
  const placeId = await place(organizationId, qid);
  const photoId = await photo(placeId, organizationId);

  await collection(organizationId, [placeId], true);

  return { placeId, photoId };
};

describe("home banner pool", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_home_banner");
    await db.migrate();

    const org = async (slug: string) =>
      (
        await admin$<{ id: string }>(
          `insert into public.organizations (name, slug, kind) values ($1, $1, 'municipality') returning id`,
          [slug],
        )
      )[0]!.id;

    orgA = await org("gmina-a");
    orgB = await org("gmina-b");
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("gives the place of the pool with its photo, credit and crop", async () => {
    const { placeId, photoId } = await ready("Q101");

    expect(await getHomeBanner(deps, () => 0, pool("Q101"))).toMatchObject({
      placeId,
      photoId,
      width: 1600,
      authorText: "Autor",
      licenseLabel: "CC BY-SA 4.0",
      focus: focus(1),
    });
  });

  it("never gives a place outside the pool or without a Wikidata id", async () => {
    const withoutQid = await place(orgA, null);

    await photo(withoutQid, orgA);
    await collection(orgA, [withoutQid], true);
    await ready("Q102");

    expect(await getHomeBanner(deps, () => 0, pool("Q103"))).toBeNull();
  });

  it("does not choose a place whose only photo is hidden", async () => {
    const { photoId } = await ready("Q111");

    await admin$(`update public.place_photos set hidden_at = now() where id = $1`, [photoId]);

    expect(await getHomeBanner(deps, () => 0, pool("Q111"))).toBeNull();
  });

  // C-01 / X4: serwis nie poleca na Starcie terenu prywatnego, ogrodzonego ani ruiny; baner jest
  // najbardziej widocznym poleceniem miejsca. To samo miejsce bez ograniczenia wraca do puli.
  for (const [index, restriction] of (["private", "fenced", "ruin"] as const).entries()) {
    it(`never draws a place with access restriction "${restriction}" as the banner`, async () => {
      const qid = `Q15${index}`;
      const { placeId } = await ready(qid);

      await admin$(`update public.places set access_restriction = $2 where id = $1`, [
        placeId,
        restriction,
      ]);

      expect(await getHomeBanner(deps, () => 0, pool(qid))).toBeNull();

      await admin$(`update public.places set access_restriction = 'none' where id = $1`, [placeId]);

      expect(await getHomeBanner(deps, () => 0, pool(qid))).toMatchObject({ placeId });
    });
  }

  it("does not choose a place whose photo is not ready", async () => {
    const placeId = await place(orgA, "Q112");

    await photo(placeId, orgA, { state: "pending_fetch" });
    await collection(orgA, [placeId], true);

    expect(await getHomeBanner(deps, () => 0, pool("Q112"))).toBeNull();
  });

  it("skips a too narrow photo and a panorama, and takes the next good one of the place", async () => {
    const narrow = await place(orgA, "Q113");
    const wide = await place(orgA, "Q114");
    const mixed = await place(orgA, "Q115");

    await photo(narrow, orgA, { width: 1000, height: 800 });
    await photo(wide, orgA, { width: 3200, height: 1000 });
    await photo(mixed, orgA, { width: 3200, height: 1000 });
    const good = await photo(mixed, orgA, { width: 1100, height: 619 });

    await collection(orgA, [narrow, wide, mixed], true);

    expect(await getHomeBanner(deps, () => 0, pool("Q113"))).toBeNull();
    expect(await getHomeBanner(deps, () => 0, pool("Q114"))).toBeNull();
    // 1100 x 619 is the edge of both limits (>= 1100 px, 16:9 at most).
    expect(await getHomeBanner(deps, () => 0, pool("Q115"))).toMatchObject({ photoId: good });
  });

  it("does not choose a place outside a published collection (draft, none)", async () => {
    const inDraft = await place(orgA, "Q121");
    const alone = await place(orgA, "Q122");

    await photo(inDraft, orgA);
    await photo(alone, orgA);
    await collection(orgA, [inDraft], false);

    expect(await getHomeBanner(deps, () => 0, pool("Q121", "Q122"))).toBeNull();
  });

  it("does not choose a place of a not approved organization", async () => {
    const { placeId } = await ready("Q123");

    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgB]);

    try {
      const other = await place(orgB, "Q124");

      await photo(other, orgB);
      await collection(orgB, [other], true);

      expect(await getHomeBanner(deps, () => 0, pool("Q124"))).toBeNull();
      expect(await getHomeBanner(deps, () => 0, pool("Q123"))).toMatchObject({ placeId });
    } finally {
      await admin$(`update public.organizations set status = 'approved' where id = $1`, [orgB]);
    }
  });

  it("gives one place for a Wikidata id used twice (the oldest id), so none is likelier", async () => {
    const first = await ready("Q131", orgA);
    const second = await ready("Q131", orgB);
    const oldest = [first.placeId, second.placeId].sort()[0];

    for (const draw of [0, 0.5, 0.99]) {
      expect(await getHomeBanner(deps, () => draw, pool("Q131"))).toMatchObject({
        placeId: oldest,
      });
    }
  });

  it("draws among the places that qualify, ignoring those that do not", async () => {
    const a = await ready("Q141");
    const b = await ready("Q142");
    const hiddenOne = await ready("Q143");

    await admin$(`update public.place_photos set hidden_at = now() where id = $1`, [
      hiddenOne.photoId,
    ]);

    const list = pool("Q141", "Q142", "Q143");

    expect(await getHomeBanner(deps, () => 0, list)).toMatchObject({ placeId: a.placeId });
    expect(await getHomeBanner(deps, () => 0.9, list)).toMatchObject({ placeId: b.placeId });
  });

  it("gives nothing for an empty pool", async () => {
    expect(await getHomeBanner(deps, () => 0, [])).toBeNull();
  });
});
