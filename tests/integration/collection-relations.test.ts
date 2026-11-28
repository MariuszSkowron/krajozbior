import { randomInt } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import {
  getPublishedCollection,
  listRelatedCollections,
} from "@/features/catalog/application/public-catalog";
import { MAX_RELATED_COLLECTIONS } from "@/features/catalog/domain/limits";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// Druga warstwa kolekcji: the relation land <-> theme collection is computed at read time from
// the common places, in the guest context on a pool of one connection as krajozbior_app (RLS on).
// Rows are prepared by the superuser connection.
let db: ScratchDatabase;
let app: MikroORM;

let orgA = "";
let orgB = "";
let orgSuspended = "";

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

const deps: CatalogDeps = {
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
};

let counter = 0;

async function collection(
  title: string,
  kind: "land" | "theme",
  options: { organization?: string; status?: "draft" | "published" } = {},
) {
  counter += 1;

  return (
    await admin$<{ id: string }>(
      `insert into public.collections (slug, organization_id, title, region, status, kind)
       values ($1, $2, $3, 'warminsko_mazurskie', $4, $5) returning id`,
      [
        `powiazane-${counter}`,
        options.organization ?? orgA,
        title,
        options.status ?? "published",
        kind,
      ],
    )
  )[0]!.id;
}

async function place(name: string, collections: readonly string[], organization = orgA) {
  const id = (
    await admin$<{ id: string }>(
      `insert into public.places (organization_id, name, address, latitude, longitude)
       values ($1, $2, 'Olsztyn', 53.78, 20.49) returning id`,
      [organization, name],
    )
  )[0]!.id;

  for (const collectionId of collections) {
    await admin$(
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values ($1, $2, $3, (select count(*) + 1 from public.collection_places where collection_id = $1))`,
      [collectionId, id, organization],
    );
  }

  return id;
}

const related = async (id: string, kind: "land" | "theme") =>
  listRelatedCollections({ id, kind }, deps);
const titlesOf = (rows: readonly { title: string }[]) => rows.map((row) => row.title);

describe("related collections (land <-> theme, guest context, RLS on)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_relations");
    await db.migrate();

    const org = async (name: string, slug: string) =>
      (
        await admin$<{ id: string }>(
          `insert into public.organizations (name, slug, kind) values ($1, $2, 'municipality') returning id`,
          [name, slug],
        )
      )[0]!.id;

    orgA = await org("Gmina A", "gmina-a");
    orgB = await org("Gmina B", "gmina-b");
    orgSuspended = await org("Gmina Zawieszona", "gmina-zawieszona");

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("gives a land its theme collections, most common places first, then by title", async () => {
    const land = await collection("Warmia", "land");
    const wieze = await collection("Wieże ciśnień", "theme");
    const zamki = await collection("Zamki", "theme");
    const kopernik = await collection("Kopernik", "theme");

    await place("A1", [land, wieze, zamki]);
    await place("A2", [land, wieze]);
    await place("A3", [land, wieze, kopernik]);
    await place("A4", [land, zamki]);
    await place("A5", [land]);

    const rows = await related(land, "land");

    expect(rows.map((row) => [row.title, row.sharedPlaces])).toEqual([
      ["Wieże ciśnień", 3],
      ["Zamki", 2],
      ["Kopernik", 1],
    ]);
    expect(rows[0]).toMatchObject({
      slug: expect.any(String),
      region: "warminsko_mazurskie",
      extraRegions: [],
      placeCount: 3,
      cover: null,
    });
  });

  it("gives a theme collection its lands, and never a collection of the same kind or itself", async () => {
    const warmia = await collection("Warmia 2", "land");
    const mazury = await collection("Mazury 2", "land");
    const wieze = await collection("Wieże 2", "theme");
    const innyTemat = await collection("Inny temat 2", "theme");

    await place("B1", [warmia, wieze, innyTemat]);
    await place("B2", [warmia, wieze]);
    await place("B3", [mazury, wieze]);

    const rows = await related(wieze, "theme");

    expect(rows.map((row) => [row.title, row.sharedPlaces])).toEqual([
      ["Warmia 2", 2],
      ["Mazury 2", 1],
    ]);
    expect(titlesOf(await related(warmia, "land"))).toEqual(["Wieże 2", "Inny temat 2"]);
  });

  it("does not list a draft, and a place shared with a draft adds nothing", async () => {
    const land = await collection("Kraina z wersją roboczą", "land");
    const published = await collection("Temat opublikowany", "theme");
    const draft = await collection("Temat roboczy", "theme", { status: "draft" });

    await place("C1", [land, published, draft]);
    await place("C2", [land, draft]);

    const rows = await related(land, "land");

    expect(rows.map((row) => [row.title, row.sharedPlaces])).toEqual([["Temat opublikowany", 1]]);
    // A draft has no related collections of its own for a guest: the draft itself is invisible.
    expect(await related(draft, "theme")).toEqual([]);
  });

  it("does not list a collection of a suspended organization, nor any for one", async () => {
    const land = await collection("Kraina zawieszona", "land", { organization: orgSuspended });
    const theme = await collection("Temat zawieszony", "theme", { organization: orgSuspended });

    await place("D1", [land, theme], orgSuspended);
    expect(titlesOf(await related(land, "land"))).toEqual(["Temat zawieszony"]);

    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [
      orgSuspended,
    ]);
    try {
      expect(await related(land, "land")).toEqual([]);
      expect(await related(theme, "theme")).toEqual([]);
    } finally {
      await admin$(`update public.organizations set status = 'approved' where id = $1`, [
        orgSuspended,
      ]);
    }
  });

  it("does not relate a collection of another organization", async () => {
    const land = await collection("Kraina organizacji A", "land");
    const foreignTheme = await collection("Temat organizacji B", "theme", { organization: orgB });

    await place("E1", [land]);
    await place("E2", [foreignTheme], orgB);

    expect(await related(land, "land")).toEqual([]);
    expect(await related(foreignTheme, "theme")).toEqual([]);
  });

  it("gives nothing for a collection without places or without related collections", async () => {
    const empty = await collection("Pusta kraina", "land");
    const alone = await collection("Kraina bez tematów", "land");

    await place("F1", [alone]);

    expect(await related(empty, "land")).toEqual([]);
    expect(await related(alone, "land")).toEqual([]);
  });

  it("returns at most MAX_RELATED_COLLECTIONS collections", async () => {
    const land = await collection("Kraina z wieloma tematami", "land");
    const themes: string[] = [];

    for (let i = 1; i <= MAX_RELATED_COLLECTIONS + 1; i += 1) {
      themes.push(await collection(`Temat graniczny ${String(i).padStart(2, "0")}`, "theme"));
    }

    await place("G1", [land, ...themes]);

    const rows = await related(land, "land");

    expect(rows).toHaveLength(MAX_RELATED_COLLECTIONS);
    expect(rows[0]!.title).toBe("Temat graniczny 01");
  });

  it("reads the kind with the published collection", async () => {
    const land = await collection("Kraina z rodzajem", "land");
    const theme = await collection("Temat z rodzajem", "theme");

    await place("H1", [land, theme]);

    const slugOf = async (id: string) =>
      (
        await admin$<{ slug: string }>(`select slug from public.collections where id = $1`, [id])
      )[0]!.slug;
    const landPage = await getPublishedCollection(await slugOf(land), deps);
    const themePage = await getPublishedCollection(await slugOf(theme), deps);

    expect(landPage).toMatchObject({ status: "ok", value: { kind: "land" } });
    expect(themePage).toMatchObject({ status: "ok", value: { kind: "theme" } });
  });
});
