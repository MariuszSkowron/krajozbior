import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  executeCatalogImport,
  type ValidImportFile,
} from "@/features/catalog/application/catalog-import";
import { runCatalogImport } from "@/features/catalog/application/catalog-import-command";
import type {
  CatalogImportDeps,
  CatalogImportOutcome,
  CollectionReport,
} from "@/features/catalog/application/catalog-import-types";
import {
  deleteDraftCollection,
  updateCollection,
} from "@/features/catalog/application/curator-collections";
import { reorderPlaces, updatePlace } from "@/features/catalog/application/curator-places";
import { parseImportFile } from "@/features/catalog/domain/import-file";
import { postgresCatalogImportRepository } from "@/features/catalog/infrastructure/postgres-catalog-import-repository";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// Loading an approved collection file (PR-A, step A3) on a real database as
// krajozbior_app: first load, a second one (noop), edits made in the panel,
// keys outside the file, refusals, the lock against two simultaneous loads.
const fixture = readFileSync("tests/fixtures/curation/minimal.ndjson", "utf8");
const batchLine = fixture.split("\n")[0]!;

let db: ScratchDatabase;
let appOrm: MikroORM;
let racerOrm: MikroORM;

const user = (name: string) => ({
  id: randomUUID(),
  role: "user" as const,
  email: `${name}@example.com`,
});
const curA = user("cur-a");
const curB = user("cur-b");
const curS = user("cur-s");
const curR = user("cur-r");
const outsider = user("outsider");

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

const makeDeps = (orm: MikroORM): CatalogImportDeps => ({
  catalog: {
    withUserContext: (actor, work) => runInUserContext(orm.em, actor, work),
    withGuestContext: (work) => runInGuestContext(orm.em, work),
    limiter: { reserve: async () => ({ allowed: true }) },
    repository: postgresCatalogRepository,
    random: (max) => randomInt(max),
  },
  imports: postgresCatalogImportRepository,
});

const parse = (text: string): ValidImportFile => {
  const result = parseImportFile(text);

  if (!result.ok) {
    throw new Error(`fixture invalid: ${JSON.stringify(result.errors)}`);
  }

  return result;
};

const load = (
  actor: { id: string; role: "user" },
  slug: string,
  text = fixture,
  options: { preview?: boolean; orm?: MikroORM } = {},
) =>
  executeCatalogImport(
    { actor, orgSlug: slug, file: parse(text), preview: options.preview ?? false },
    makeDeps(options.orm ?? appOrm),
  );

const done = (outcome: CatalogImportOutcome): readonly CollectionReport[] => {
  if (outcome.kind !== "done") {
    throw new Error(`expected done, got ${outcome.kind}`);
  }

  return outcome.collections;
};

const counts = async (orgSlug: string) => {
  const [row] = await admin$<{ collections: number; places: number; keys: number }>(
    `select (select count(*)::int from collections c join organizations o on o.id = c.organization_id where o.slug = $1) as collections,
            (select count(*)::int from places p join organizations o on o.id = p.organization_id where o.slug = $1) as places,
            (select count(*)::int from catalog_import_keys k join organizations o on o.id = k.organization_id where o.slug = $1) as keys`,
    [orgSlug],
  );

  return row!;
};

const placeNamesOf = async (collectionTitle: string) =>
  (
    await admin$<{ name: string }>(
      `select p.name from collection_places cp
         join collections c on c.id = cp.collection_id
         join places p on p.id = cp.place_id
        where c.title = $1 order by cp.position`,
      [collectionTitle],
    )
  ).map((row) => row.name);

const results = (reports: readonly CollectionReport[]) =>
  reports.map((r) => ({
    result: r.result,
    composition: r.composition,
    places: r.places.map((p) => p.result),
  }));

describe("loading a collection file", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_catalog_load");
    await db.migrate();

    for (const { id, email } of [curA, curB, curS, curR, outsider]) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }

    for (const [slug, member] of [
      ["gmina-a", curA],
      ["gmina-b", curB],
      ["gmina-s", curS],
      ["gmina-r", curR],
    ] as const) {
      const [{ id }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ($1, $2, 'municipality') returning id`,
        [slug, slug],
      );

      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [id, member.id],
      );
    }

    await admin$(`update public.organizations set status = 'suspended' where slug = 'gmina-s'`);
    appOrm = await MikroORM.init(createOrmConfig(db.urls.krajozbior_app));
    racerOrm = await MikroORM.init(createOrmConfig(db.urls.krajozbior_app));
  }, 60_000);

  afterAll(async () => {
    await appOrm?.close(true);
    await racerOrm?.close(true);
    await db?.drop();
  });

  it("runs as krajozbior_app, not as an owner of the tables", async () => {
    const [row] = await appOrm.em.execute<{ current_user: string; rolbypassrls: boolean }[]>(
      `select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as rolbypassrls`,
    );

    expect(row).toEqual({ current_user: "krajozbior_app", rolbypassrls: false });
  });

  it("a preview with the database writes nothing", async () => {
    const outcome = await load(curA, "gmina-a", fixture, { preview: true });

    expect(outcome).toMatchObject({
      kind: "preview",
      preview: {
        collections: { create: 2 },
        places: { create: 3 },
        orphanedKeys: { collection: 0, place: 0 },
        collectionLimitExceeded: false,
      },
    });
    expect(await counts("gmina-a")).toEqual({ collections: 0, places: 0, keys: 0 });
  });

  it("the first load creates drafts with the places in file order, for the curator's organization", async () => {
    const reports = done(await load(curA, "gmina-a"));

    // The second place is shared: created with the first collection, found in the second.
    expect(results(reports)).toEqual([
      { result: "created", composition: "synced", places: ["created", "created"] },
      { result: "created", composition: "synced", places: ["noop", "created"] },
    ]);
    expect(await counts("gmina-a")).toEqual({ collections: 2, places: 3, keys: 5 });
    expect(await placeNamesOf("Kolekcja testowa jeden")).toEqual([
      "Miejsce testowe pierwsze",
      "Miejsce testowe drugie",
    ]);
    expect(await placeNamesOf("Kolekcja testowa dwa")).toEqual([
      "Miejsce testowe drugie",
      "Miejsce testowe trzecie",
    ]);

    const states = await admin$<{ status: string; first_published_at: Date | null }>(
      `select status, first_published_at from collections`,
    );

    expect(states.every((s) => s.status === "draft" && s.first_published_at === null)).toBe(true);
  });

  it("the second load of the same file is a noop and changes no version", async () => {
    const before = await admin$(`select id, version from collections order by id`);
    const placesBefore = await admin$(`select id, version from places order by id`);
    const keysBefore = await admin$(
      `select entity_id, imported_at from catalog_import_keys order by entity_id`,
    );
    const reports = done(await load(curA, "gmina-a"));

    expect(results(reports)).toEqual([
      { result: "noop", composition: "noop", places: ["noop", "noop"] },
      { result: "noop", composition: "noop", places: ["noop", "noop"] },
    ]);
    expect(await admin$(`select id, version from collections order by id`)).toEqual(before);
    expect(await admin$(`select id, version from places order by id`)).toEqual(placesBefore);
    expect(
      await admin$(`select entity_id, imported_at from catalog_import_keys order by entity_id`),
    ).toEqual(keysBefore);
  });

  it("keeps what a curator changed in the panel (place, title, order) and writes nothing over it", async () => {
    const deps = makeDeps(appOrm).catalog;
    const [place] = await admin$<{ id: string; version: number }>(
      `select id, version from places where name = 'Miejsce testowe pierwsze'`,
    );
    const [first] = await admin$<{ id: string; version: number }>(
      `select id, version from collections where title = 'Kolekcja testowa jeden'`,
    );
    const [second] = await admin$<{ id: string }>(
      `select id from collections where title = 'Kolekcja testowa dwa'`,
    );
    const secondPlaces = await admin$<{ place_id: string }>(
      `select place_id from collection_places where collection_id = $1 order by position`,
      [second!.id],
    );

    expect(
      (
        await updatePlace(
          curA,
          place!.id,
          { name: "Nazwa z panelu", version: place!.version },
          deps,
        )
      ).status,
    ).toBe("ok");
    expect(
      (
        await updateCollection(
          curA,
          first!.id,
          { title: "Tytuł z panelu", version: first!.version },
          deps,
        )
      ).status,
    ).toBe("ok");
    expect(
      (
        await reorderPlaces(
          curA,
          second!.id,
          { placeIds: secondPlaces.map((r) => r.place_id).reverse() },
          deps,
        )
      ).status,
    ).toBe("ok");

    const changedFile = fixture.replace("Kolekcja testowa dwa", "Kolekcja testowa dwa zmieniona");
    const reports = done(await load(curA, "gmina-a", changedFile));

    expect(reports[0]).toMatchObject({
      result: "kept_manual_edit",
      composition: "kept_manual_edit",
    });
    expect(reports[0]!.places.map((p) => p.result)).toEqual(["kept_manual_edit", "noop"]);
    // The title of the second collection follows the file (its version is the loaded one),
    // the order made in the panel stays.
    expect(reports[1]).toMatchObject({ result: "updated", composition: "kept_manual_edit" });
    expect(await admin$(`select name from places where id = $1`, [place!.id])).toEqual([
      { name: "Nazwa z panelu" },
    ]);
    expect(await admin$(`select title from collections where id = $1`, [first!.id])).toEqual([
      { title: "Tytuł z panelu" },
    ]);
    expect(await placeNamesOf("Kolekcja testowa dwa zmieniona")).toEqual([
      "Miejsce testowe trzecie",
      "Miejsce testowe drugie",
    ]);

    // A third load: still kept, nothing moves.
    const again = done(await load(curA, "gmina-a", changedFile));

    expect(again[0]!.result).toBe("kept_manual_edit");
    expect(again[1]).toMatchObject({ result: "noop", composition: "kept_manual_edit" });
  });

  it("does not create again a draft deleted in the panel", async () => {
    const deps = makeDeps(appOrm).catalog;
    const [second] = await admin$<{ id: string }>(
      `select id from collections where title = 'Kolekcja testowa dwa zmieniona'`,
    );

    expect((await deleteDraftCollection(curA, second!.id, deps)).status).toBe("ok");

    const changedFile = fixture.replace("Kolekcja testowa dwa", "Kolekcja testowa dwa zmieniona");
    const before = await counts("gmina-a");
    const reports = done(await load(curA, "gmina-a", changedFile));

    expect(reports[1]).toMatchObject({ result: "kept_manual_delete", places: [] });
    expect((await counts("gmina-a")).collections).toBe(before.collections);

    const preview = await load(curA, "gmina-a", changedFile, { preview: true });

    expect(preview).toMatchObject({ preview: { orphanedKeys: { collection: 1 } } });
  });

  it("links a place of the organization named outside the file, without a duplicate", async () => {
    const before = await counts("gmina-a");
    const text = [
      batchLine,
      JSON.stringify({
        type: "collection",
        import_key: "col:testowa-trzy",
        title: "Kolekcja testowa trzy",
        summary: "Z miejscem spoza pliku.",
        region: "pomorskie",
        places: ["ext:TEST-0001"],
        review: { status: "approved" },
      }),
    ].join("\n");
    const reports = done(await load(curA, "gmina-a", text));

    expect(results(reports)).toEqual([
      { result: "created", composition: "synced", places: ["linked_existing"] },
    ]);
    expect(await counts("gmina-a")).toEqual({
      collections: before.collections + 1,
      places: before.places,
      keys: before.keys + 1,
    });
    expect(done(await load(curA, "gmina-a", text))[0]!.places[0]!.result).toBe("noop");
  });

  it("rejects the whole file, writing nothing, when a key outside it is unknown or of another organization", async () => {
    const text = (key: string) =>
      [
        batchLine,
        JSON.stringify({
          type: "collection",
          import_key: "col:testowa-cztery",
          title: "Kolekcja testowa cztery",
          summary: "Z nieznanym miejscem.",
          region: "pomorskie",
          places: [key],
          review: { status: "approved" },
        }),
      ].join("\n");

    await load(curB, "gmina-b");
    const before = await counts("gmina-a");

    // ext:TEST-0001 exists only as a key of organization A; B has loaded its own copy, so use an unknown one,
    // and an organization that has no key at all.
    expect(await load(curA, "gmina-a", text("ext:NOPE-1"))).toEqual({
      kind: "rejected",
      code: "unknown_external_key",
      count: 1,
    });
    expect(await load(curR, "gmina-r", text("ext:TEST-0001"))).toMatchObject({
      kind: "rejected",
    });
    expect(await counts("gmina-a")).toEqual(before);
    expect(await counts("gmina-r")).toEqual({ collections: 0, places: 0, keys: 0 });
    expect(await load(curA, "gmina-a", text("ext:NOPE-1"), { preview: true })).toMatchObject({
      kind: "rejected",
    });
  });

  it("refuses without writing: a curator of another organization, a suspended organization, an account without membership, an unknown slug", async () => {
    const before = [await counts("gmina-a"), await counts("gmina-s")];
    const refused = { kind: "refused", code: "organization_unavailable" };

    expect(await load(curB, "gmina-a")).toEqual(refused);
    expect(await load(curS, "gmina-s")).toEqual(refused);
    expect(await load(outsider, "gmina-a")).toEqual(refused);
    expect(await load(curA, "nie-ma-takiej")).toEqual(refused);
    expect(await load(curB, "gmina-a", fixture, { preview: true })).toEqual(refused);
    expect([await counts("gmina-a"), await counts("gmina-s")]).toEqual(before);
  });

  it("a guest reads no import keys, through the same connection", async () => {
    const rows = await runInGuestContext(appOrm.em, ({ em }) =>
      em.execute(`select import_key from public.catalog_import_keys`),
    );

    expect(rows).toEqual([]);
  });

  it("two simultaneous loads create every collection and place once; the lock serializes them", async () => {
    const [a, b] = await Promise.all([
      load(curR, "gmina-r", fixture, { orm: appOrm }),
      load(curR, "gmina-r", fixture, { orm: racerOrm }),
    ]);
    const all = [...done(a), ...done(b)].flatMap((r) => [
      r.result,
      ...r.places.map((p) => p.result),
    ]);

    expect(await counts("gmina-r")).toEqual({ collections: 2, places: 3, keys: 5 });
    expect(all.filter((r) => r === "created")).toHaveLength(5);
    expect(all.every((r) => r === "created" || r === "noop")).toBe(true);
    expect(done(await load(curR, "gmina-r")).every((r) => r.result === "noop")).toBe(true);
  });

  it("refuses a collection in the middle of a file and rolls only it back (limit of collections)", async () => {
    const [{ id }] = await admin$<{ id: string }>(
      `select id from organizations where slug = 'gmina-r'`,
    );

    await admin$(
      `insert into collections (slug, organization_id, title, region)
       select 'wypelniacz-' || g, $1, 'Wypełniacz', 'pomorskie' from generate_series(1, 197) g`,
      [id],
    );

    const text = (n: number) =>
      [
        batchLine,
        ...[1, 2, 3].slice(0, n).map((i) =>
          JSON.stringify({
            type: "collection",
            import_key: `col:limit-${i}`,
            title: `Kolekcja limitowa ${i}`,
            summary: "Do limitu.",
            region: "pomorskie",
            places: ["ext:TEST-0001"],
            review: { status: "approved" },
          }),
        ),
      ].join("\n");
    const reports = done(await load(curR, "gmina-r", text(3)));

    expect(reports.map((r) => r.result)).toEqual(["created", "refused", "refused"]);
    expect(reports[1]!.refusal).toBe("conflict:too_many_collections");
    expect(await load(curR, "gmina-r", text(3), { preview: true })).toMatchObject({
      preview: { collectionLimitExceeded: true },
    });
    expect((await counts("gmina-r")).collections).toBe(200);
  });

  it("shows no detail of a foreign key error (23503) in the command output", async () => {
    // A real 23503 from the database, thrown from inside a real load.
    const foreign = await withClient(db.adminUrl, async (client) => {
      try {
        await client.query(
          `insert into public.collection_places (collection_id, place_id, organization_id, position)
           values ($1, $2, $3, 1)`,
          [randomUUID(), randomUUID(), randomUUID()],
        );
      } catch (error) {
        return error;
      }

      throw new Error("expected a foreign key error");
    });

    expect((foreign as { code: string }).code).toBe("23503");

    const text = [
      batchLine,
      JSON.stringify({
        type: "collection",
        import_key: "col:testowa-piec",
        title: "Kolekcja testowa pięć",
        summary: "Z awarią.",
        region: "pomorskie",
        places: ["ext:TEST-0001"],
        review: { status: "approved" },
      }),
    ].join("\n");
    const deps = makeDeps(appOrm);
    const failing: CatalogImportDeps = {
      ...deps,
      imports: {
        ...deps.imports,
        insertKey: async () => {
          throw foreign;
        },
      },
    };
    const output = await runCatalogImport(
      ["--file", "x", "--org-slug", "gmina-a", "--curator-email", curA.email],
      {
        readFile: async () => text,
        connect: async () => ({
          run: ({ orgSlug, file }) =>
            executeCatalogImport({ actor: curA, orgSlug, file, preview: false }, failing),
          close: async () => undefined,
        }),
      },
    );
    const printed = [...output.stdout, ...output.stderr].join("\n");

    expect(output.exitCode).toBe(1);
    expect(printed).toContain("klasa 23");
    expect(printed).not.toMatch(/collection_places|fkey|violates|constraint|Key \(/i);
    // The collection of the failed transaction was rolled back.
    expect(await admin$(`select 1 from collections where title = 'Kolekcja testowa pięć'`)).toEqual(
      [],
    );
  });
});
