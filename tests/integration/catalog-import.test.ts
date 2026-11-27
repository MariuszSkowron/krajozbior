import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  executeCatalogImport,
  executeCatalogRemove,
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
const curU = user("cur-u");
const curP = user("cur-p");
const curL = user("cur-l");

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
  options: { preview?: boolean; orm?: MikroORM; publish?: boolean } = {},
) =>
  executeCatalogImport(
    {
      actor,
      orgSlug: slug,
      file: parse(text),
      preview: options.preview ?? false,
      publish: options.publish ?? false,
    },
    makeDeps(options.orm ?? appOrm),
  );

const remove = (actor: { id: string; role: "user" }, slug: string, text = fixture) =>
  executeCatalogRemove({ actor, orgSlug: slug, file: parse(text) }, makeDeps(appOrm));

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
            (select count(*)::int from catalog_import_keys k join organizations o on o.id = k.organization_id where o.slug = $1 and k.entity_kind <> 'photo') as keys`,
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

    for (const { id, email } of [curA, curB, curS, curR, outsider, curU, curP, curL]) {
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
      ["gmina-u", curU],
      ["gmina-p", curP],
      ["gmina-l", curL],
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

  it("writes the source of every place, adds a missing one on a reload and never turns a curator's description back", async () => {
    const sourcesOf = () =>
      admin$<{
        name: string;
        description_method: string;
        attribution: string;
        wikipedia_url: string | null;
        wikidata_qid: string | null;
        retrieved_at: Date;
      }>(
        `select p.name, s.description_method, s.attribution, s.wikipedia_url, s.wikidata_qid, s.retrieved_at
           from place_sources s join places p on p.id = s.place_id
           join organizations o on o.id = s.organization_id
          where o.slug = 'gmina-a' order by p.name`,
      );

    // The first load wrote them (the file names its sources by key; the signature is "label (licence)").
    expect(
      (await sourcesOf()).map(({ name, description_method, attribution, wikidata_qid }) => ({
        name,
        description_method,
        attribution,
        wikidata_qid,
      })),
    ).toEqual([
      {
        name: "Miejsce testowe drugie",
        // The file marks this description as written by a person.
        description_method: "curator",
        attribution: "Źródło testowe B (CC0 1.0)",
        wikidata_qid: null,
      },
      {
        name: "Miejsce testowe pierwsze",
        description_method: "facts_template",
        attribution: "Źródło testowe A (CC0 1.0)",
        wikidata_qid: null,
      },
      {
        name: "Miejsce testowe trzecie",
        description_method: "facts_template",
        attribution: "Źródło testowe A (CC0 1.0)",
        wikidata_qid: null,
      },
    ]);
    expect((await sourcesOf())[1]).toMatchObject({
      wikipedia_url: "https://pl.wikipedia.org/wiki/Miejsce_testowe_pierwsze",
    });

    // A load of a file loaded before the sources existed fills them in; nothing else moves.
    const placesBefore = await admin$(`select id, version from places order by id`);

    await admin$(`delete from place_sources`);
    expect(done(await load(curA, "gmina-a")).map((r) => r.result)).toEqual(["noop", "noop"]);
    expect(await sourcesOf()).toHaveLength(3);
    expect(await admin$(`select id, version from places order by id`)).toEqual(placesBefore);

    // A reload of the same place content refreshes the signature and the links (a source
    // label or licence corrected in the file reaches the place); the description method stays.
    await admin$(
      `update place_sources set attribution = 'Stary podpis', wikipedia_url = null, description_method = 'curator'
        where place_id = (select id from places where name = 'Miejsce testowe pierwsze')`,
    );
    expect(done(await load(curA, "gmina-a")).map((r) => r.result)).toEqual(["noop", "noop"]);
    expect((await sourcesOf())[1]).toMatchObject({
      attribution: "Źródło testowe A (CC0 1.0)",
      wikipedia_url: "https://pl.wikipedia.org/wiki/Miejsce_testowe_pierwsze",
      description_method: "curator",
    });
    await admin$(
      `update place_sources set description_method = 'facts_template'
        where place_id = (select id from places where name = 'Miejsce testowe pierwsze')`,
    );

    // A description changed in the panel is marked as the curator's, and a reload keeps the mark.
    const [place] = await admin$<{ id: string; version: number }>(
      `select id, version from places where name = 'Miejsce testowe pierwsze'`,
    );

    expect(
      (
        await updatePlace(
          curA,
          place!.id,
          { description: "Opis poprawiony w panelu.", version: place!.version },
          makeDeps(appOrm).catalog,
        )
      ).status,
    ).toBe("ok");
    expect((await sourcesOf())[1]).toMatchObject({ description_method: "curator" });
    done(await load(curA, "gmina-a"));
    expect((await sourcesOf())[1]).toMatchObject({ description_method: "curator" });
    // The other places keep theirs.
    expect((await sourcesOf())[2]).toMatchObject({ description_method: "facts_template" });
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

// Reloading a new version of the file: what the loader
// writes after a change must be what the next load reads, or the next load
// reports a false manual edit (and, later, overwrites a real one).
type FileLine = Record<string, unknown>;

const fileLines = (): FileLine[] =>
  fixture
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as FileLine);
const fileText = (lines: readonly FileLine[]) => lines.map((l) => JSON.stringify(l)).join("\n");
const byKey = (lines: readonly FileLine[], key: string) =>
  lines.find((l) => l.import_key === key) as FileLine;

describe("reloading a new version of the file", () => {
  let current: string;

  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_catalog_reload");
    await db.migrate();

    for (const [curator, slug] of [
      [curU, "gmina-u"],
      [curP, "gmina-p"],
      [curL, "gmina-l"],
    ] as const) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        curator.id,
        slug,
        curator.email,
      ]);

      const [{ id }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ($1, $1, 'municipality') returning id`,
        [slug],
      );

      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [id, curator.id],
      );
    }

    appOrm = await MikroORM.init(createOrmConfig(db.urls.krajozbior_app));
  }, 60_000);

  afterAll(async () => {
    await appOrm?.close(true);
    await db?.drop();
  });

  const importedState = async (slug: string) =>
    admin$<{ import_key: string; imported_version: number; imported_places: string[] | null }>(
      `select k.import_key, k.imported_version, k.imported_places
         from catalog_import_keys k join organizations o on o.id = k.organization_id
        where o.slug = $1 order by k.import_key`,
      [slug],
    );

  it("(a) updates a place from the new version of the file and records the version it wrote", async () => {
    done(await load(curU, "gmina-u"));

    const lines = fileLines();

    byKey(lines, "ext:TEST-0001").name = "Miejsce testowe pierwsze, nowa nazwa";
    byKey(lines, "ext:TEST-0003").address = "Nowy adres testowy";
    current = fileText(lines);

    const reports = done(await load(curU, "gmina-u", current));

    expect(results(reports)).toEqual([
      { result: "noop", composition: "noop", places: ["updated", "noop"] },
      { result: "noop", composition: "noop", places: ["noop", "updated"] },
    ]);
    expect(await admin$(`select name from places where name like '%nowa nazwa'`)).toHaveLength(1);

    const stored = await admin$<{ import_key: string; version: number; imported_version: number }>(
      `select k.import_key, p.version, k.imported_version
         from catalog_import_keys k join places p on p.id = k.entity_id
        where k.entity_kind = 'place' order by k.import_key`,
    );

    expect(stored).toHaveLength(3);
    expect(stored.every((row) => row.version === row.imported_version)).toBe(true);
  });

  it("(b) changes the composition and order of an untouched draft and records the places in order", async () => {
    const lines = fileLines();

    byKey(lines, "ext:TEST-0001").name = "Miejsce testowe pierwsze, nowa nazwa";
    byKey(lines, "ext:TEST-0003").address = "Nowy adres testowy";

    const extra = {
      ...byKey(lines, "ext:TEST-0003"),
      import_key: "ext:TEST-0004",
      name: "Miejsce testowe czwarte",
    };

    lines.push(extra);
    // Collection one: drops TEST-0002 (still in collection two), adds TEST-0003
    // and the new TEST-0004, in a new order.
    byKey(lines, "col:testowa-jeden").places = ["ext:TEST-0004", "ext:TEST-0001", "ext:TEST-0003"];
    current = fileText(lines);

    const reports = done(await load(curU, "gmina-u", current));

    expect(results(reports)).toEqual([
      { result: "updated", composition: "synced", places: ["created", "noop", "noop"] },
      { result: "noop", composition: "noop", places: ["noop", "noop"] },
    ]);
    expect(await placeNamesOf("Kolekcja testowa jeden")).toEqual([
      "Miejsce testowe czwarte",
      "Miejsce testowe pierwsze, nowa nazwa",
      "Miejsce testowe trzecie",
    ]);
    // The removed place stays in the organization and in the other collection.
    expect(await placeNamesOf("Kolekcja testowa dwa")).toEqual([
      "Miejsce testowe drugie",
      "Miejsce testowe trzecie",
    ]);

    const [collection] = await admin$<{ id: string; imported_places: string[] }>(
      `select c.id, k.imported_places from collections c
         join catalog_import_keys k on k.entity_id = c.id
        where c.title = 'Kolekcja testowa jeden'`,
    );
    const inOrder = await admin$<{ place_id: string }>(
      `select place_id from collection_places where collection_id = $1 order by position`,
      [collection!.id],
    );

    expect(collection!.imported_places).toEqual(inOrder.map((row) => row.place_id));
  });

  it("(c) loading the same new version again is a noop and writes nothing", async () => {
    const collections = await admin$(`select id, version from collections order by id`);
    const places = await admin$(`select id, version from places order by id`);
    const state = await importedState("gmina-u");
    const keys = await admin$(
      `select entity_id, imported_at from catalog_import_keys order by entity_id`,
    );
    const reports = done(await load(curU, "gmina-u", current));

    expect(results(reports)).toEqual([
      { result: "noop", composition: "noop", places: ["noop", "noop", "noop"] },
      { result: "noop", composition: "noop", places: ["noop", "noop"] },
    ]);
    expect(await admin$(`select id, version from collections order by id`)).toEqual(collections);
    expect(await admin$(`select id, version from places order by id`)).toEqual(places);
    expect(await importedState("gmina-u")).toEqual(state);
    expect(
      await admin$(`select entity_id, imported_at from catalog_import_keys order by entity_id`),
    ).toEqual(keys);
  });

  it("(d) a published collection keeps its composition; its places still follow the file, new ones are not created", async () => {
    done(await load(curP, "gmina-p"));
    await admin$(
      `update collections set status = 'published', first_published_at = now(), version = version + 1
        where title = 'Kolekcja testowa jeden'`,
    );
    // The loader records the version it left when it publishes (A4); this
    // stands in for that, so only a later edit in the panel differs.
    await admin$(
      `update catalog_import_keys k set imported_version = c.version
         from collections c where c.id = k.entity_id and c.title = 'Kolekcja testowa jeden'`,
    );

    const lines = fileLines();

    byKey(lines, "ext:TEST-0001").name = "Miejsce testowe pierwsze, w opublikowanej";
    lines.push({
      ...byKey(lines, "ext:TEST-0003"),
      import_key: "ext:TEST-0004",
      name: "Miejsce testowe czwarte",
    });
    byKey(lines, "col:testowa-jeden").places = ["ext:TEST-0002", "ext:TEST-0001", "ext:TEST-0004"];

    const text = fileText(lines);
    const before = await placeNamesOf("Kolekcja testowa jeden");
    const placesBefore = (await counts("gmina-p")).places;
    const first = done(await load(curP, "gmina-p", text));

    expect(first[0]).toMatchObject({
      result: "skipped_already_published",
      composition: "skipped_already_published",
    });
    expect(first[0]!.places.map((p) => p.result)).toEqual([
      "noop",
      "updated",
      "skipped_collection_kept",
    ]);
    expect(await placeNamesOf("Kolekcja testowa jeden")).toEqual(
      before.map((name) =>
        name === "Miejsce testowe pierwsze" ? "Miejsce testowe pierwsze, w opublikowanej" : name,
      ),
    );
    // No place was created for the new key; the second collection (a draft) is untouched.
    expect((await counts("gmina-p")).places).toBe(placesBefore);
    expect(first[1]!.result).toBe("noop");

    const state = await importedState("gmina-p");
    const again = done(await load(curP, "gmina-p", text));

    expect(again[0]).toMatchObject({ result: "skipped_already_published" });
    expect(again[0]!.places.map((p) => p.result)).toEqual([
      "noop",
      "noop",
      "skipped_collection_kept",
    ]);
    expect(await importedState("gmina-p")).toEqual(state);
  });

  it("a refusal after a place was created rolls back the place and its key with the collection", async () => {
    const deps = makeDeps(appOrm);
    let inserted = 0;
    const failing: CatalogImportDeps = {
      ...deps,
      imports: {
        ...deps.imports,
        insertKey: async (tx, organizationId, kind, importKey, values) => {
          if (kind === "place" && ++inserted === 2) {
            throw new Error("injected failure after the first place was created");
          }

          return deps.imports.insertKey(tx, organizationId, kind, importKey, values);
        },
      },
    };

    await expect(
      executeCatalogImport(
        { actor: curL, orgSlug: "gmina-l", file: parse(fixture), preview: false },
        failing,
      ),
    ).rejects.toThrow(/injected failure/);
    expect(await counts("gmina-l")).toEqual({ collections: 0, places: 0, keys: 0 });
  });
});

// Publishing and removing (PR-A, step A4). Each test makes its own
// organization and curator, so the tests do not depend on each other.
describe("publishing and removing what a file loaded", () => {
  const explorer = user("explorer");
  const refusedOrg = { kind: "refused", code: "organization_unavailable" };

  const newOrg = async (slug: string, suspended = false) => {
    const curator = user(`cur-${slug}`);

    await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
      curator.id,
      slug,
      curator.email,
    ]);

    const [{ id }] = await admin$<{ id: string }>(
      `insert into public.organizations (name, slug, kind, status) values ($1, $1, 'municipality', $2) returning id`,
      [slug, suspended ? "suspended" : "approved"],
    );

    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [id, curator.id],
    );

    return { curator, id };
  };

  const collectionsOf = (slug: string) =>
    admin$<{
      title: string;
      slug: string;
      status: string;
      first_published_at: Date | null;
      version: number;
    }>(
      `select c.title, c.slug, c.status, c.first_published_at, c.version
         from collections c join organizations o on o.id = c.organization_id
        where o.slug = $1 order by c.title`,
      [slug],
    );
  const keyVersions = (slug: string) =>
    admin$<{ import_key: string; imported_version: number; version: number }>(
      `select k.import_key, k.imported_version, c.version
         from catalog_import_keys k
         join collections c on c.id = k.entity_id
         join organizations o on o.id = k.organization_id
        where o.slug = $1 and k.entity_kind = 'collection' order by k.import_key`,
      [slug],
    );
  const placeId = async (slug: string, name: string) =>
    (
      await admin$<{ id: string }>(
        `select p.id from places p join organizations o on o.id = p.organization_id
          where o.slug = $1 and p.name = $2`,
        [slug, name],
      )
    )[0]!.id;
  const placeExists = async (id: string) =>
    (await admin$(`select 1 from places where id = $1`, [id])).length === 1;
  const removal = (outcome: CatalogImportOutcome) => {
    if (outcome.kind !== "removed") {
      throw new Error(`expected removed, got ${outcome.kind}`);
    }

    return outcome.reports.map((r) => `${r.importKey}:${r.result}`);
  };
  const publications = (reports: readonly CollectionReport[]) =>
    reports.map((r) => r.publication ?? null);

  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_catalog_publish");
    await db.migrate();
    await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
      explorer.id,
      "explorer",
      explorer.email,
    ]);
    appOrm = await MikroORM.init(createOrmConfig(db.urls.krajozbior_app));
  }, 60_000);

  afterAll(async () => {
    await appOrm?.close(true);
    await db?.drop();
  });

  it("--publish publishes only the collection marked publish: true, with an address from the title (D-27), and records the version it left", async () => {
    const { curator } = await newOrg("pub-a");
    const reports = done(await load(curator, "pub-a", fixture, { publish: true }));

    expect(results(reports).map((r) => r.result)).toEqual(["created", "created"]);
    expect(publications(reports)).toEqual(["published", null]);

    const rows = await collectionsOf("pub-a");
    const published = rows.find((r) => r.title === "Kolekcja testowa jeden")!;
    const draft = rows.find((r) => r.title === "Kolekcja testowa dwa")!;

    expect(published.status).toBe("published");
    expect(published.first_published_at).not.toBeNull();
    expect(published.slug).toMatch(/^kolekcja-testowa-jeden/);
    expect(draft).toMatchObject({ status: "draft", first_published_at: null });
    // What the loader recorded is what the next load reads.
    expect(await keyVersions("pub-a")).toEqual([
      { import_key: "col:testowa-dwa", imported_version: draft.version, version: draft.version },
      {
        import_key: "col:testowa-jeden",
        imported_version: published.version,
        version: published.version,
      },
    ]);
  });

  it("loading again after --publish is a noop / skipped_already_published, with or without the flag", async () => {
    const { curator } = await newOrg("pub-b");

    done(await load(curator, "pub-b", fixture, { publish: true }));

    const before = await collectionsOf("pub-b");
    const keys = await keyVersions("pub-b");

    for (const publish of [true, false]) {
      const reports = done(await load(curator, "pub-b", fixture, { publish }));

      expect(reports.map((r) => r.result)).toEqual(["skipped_already_published", "noop"]);
      expect(publications(reports)).toEqual([publish ? "skipped_already_published" : null, null]);
    }

    expect(await collectionsOf("pub-b")).toEqual(before);
    expect(await keyVersions("pub-b")).toEqual(keys);
  });

  it("extra_regions: absent keeps, a list sets (also when published, version stays), the same list is unchanged, [] clears, a preview writes nothing", async () => {
    const { curator } = await newOrg("xr-a");
    const withExtra = (jeden: unknown, dwa: unknown) => {
      const lines = fileLines();

      for (const [key, value] of [
        ["col:testowa-jeden", jeden],
        ["col:testowa-dwa", dwa],
      ] as const) {
        if (value !== undefined) {
          byKey(lines, key).extra_regions = value;
        }
      }

      return fileText(lines);
    };
    const extraOf = async () =>
      (
        await admin$<{ title: string; extra_regions: string[] }>(
          `select c.title, c.extra_regions from collections c
             join organizations o on o.id = c.organization_id
            where o.slug = 'xr-a' order by c.title`,
        )
      ).map((row) => row.extra_regions);
    const extraResults = (reports: readonly CollectionReport[]) =>
      reports.map((r) => r.extraRegions ?? null);
    const file = withExtra(["zachodniopomorskie", "kujawsko_pomorskie"], ["lodzkie"]);

    // A file without the field: the report has no `extraRegions`, the lists stay empty.
    const first = done(await load(curator, "xr-a", fixture, { publish: true }));

    expect(extraResults(first)).toEqual([null, null]);
    expect(await extraOf()).toEqual([[], []]);

    const before = await collectionsOf("xr-a");
    const keys = await keyVersions("xr-a");
    const preview = await load(curator, "xr-a", file, { preview: true, publish: true });

    expect(preview).toMatchObject({ kind: "preview", preview: { extraRegions: { updated: 2 } } });
    expect(await extraOf()).toEqual([[], []]);

    // Set, also in the published collection; no version moves, so no false manual edit.
    const second = done(await load(curator, "xr-a", file, { publish: true }));

    expect(second.map((r) => r.result)).toEqual(["skipped_already_published", "noop"]);
    expect(extraResults(second)).toEqual(["updated", "updated"]);
    // The order of the file is kept, the database does not sort.
    expect(await extraOf()).toEqual([["zachodniopomorskie", "kujawsko_pomorskie"], ["lodzkie"]]);
    expect(await collectionsOf("xr-a")).toEqual(before);
    expect(await keyVersions("xr-a")).toEqual(keys);

    // The same file again: unchanged; the draft is not reported as edited by hand.
    const third = done(await load(curator, "xr-a", file, { publish: true }));

    expect(third.map((r) => r.result)).toEqual(["skipped_already_published", "noop"]);
    expect(extraResults(third)).toEqual(["unchanged", "unchanged"]);

    // The lists are compared as sets: the same voivodeships in another order are no change.
    const reordered = await load(
      curator,
      "xr-a",
      withExtra(["kujawsko_pomorskie", "zachodniopomorskie"], ["lodzkie"]),
      { preview: true },
    );

    expect(reordered.kind === "preview" && reordered.preview.extraRegions).toBeUndefined();

    // The field absent again: nothing changes.
    expect(extraResults(done(await load(curator, "xr-a", fixture, { publish: true })))).toEqual([
      null,
      null,
    ]);
    expect(await extraOf()).toEqual([["zachodniopomorskie", "kujawsko_pomorskie"], ["lodzkie"]]);

    // `[]` clears one, the other stays.
    const cleared = done(await load(curator, "xr-a", withExtra([], undefined), { publish: true }));

    expect(extraResults(cleared)).toEqual(["updated", null]);
    expect(await extraOf()).toEqual([[], ["lodzkie"]]);
    expect(await collectionsOf("xr-a")).toEqual(before);
  });

  it("extra_regions: a main voivodeship changed in the panel leaves the extra ones in the same write", async () => {
    const { curator } = await newOrg("xr-b");

    done(await load(curator, "xr-b", fixture));

    const lines = fileLines();

    byKey(lines, "col:testowa-dwa").extra_regions = ["lodzkie", "opolskie"];
    done(await load(curator, "xr-b", fileText(lines)));

    // The curator makes one of the extra voivodeships the main one (the CHECK would refuse both).
    const [{ id, version }] = await admin$<{ id: string; version: number }>(
      `select c.id, c.version from collections c join organizations o on o.id = c.organization_id
        where o.slug = 'xr-b' and c.title = 'Kolekcja testowa dwa'`,
    );
    const updated = await runInUserContext(appOrm.em, curator, (tx) =>
      postgresCatalogRepository.updateCollection(tx, id, version, {
        title: "Kolekcja testowa dwa",
        summary: "Opis",
        region: "lodzkie",
      }),
    );

    expect(updated).toMatchObject({ region: "lodzkie", extraRegions: ["opolskie"] });

    // The next load: the file asks for lodzkie among the extra ones, which the main one already is.
    const reload = done(await load(curator, "xr-b", fileText(lines)));

    expect(reload[1]).toMatchObject({ result: "kept_manual_edit" });
    expect(reload[1]!.extraRegions).toBe("unchanged");
  });

  it("an edit made in the panel after publication is kept_manual_edit", async () => {
    const { curator } = await newOrg("pub-c");

    done(await load(curator, "pub-c", fixture, { publish: true }));

    const [published] = (await collectionsOf("pub-c")).filter((r) => r.status === "published");
    const [{ id }] = await admin$<{ id: string }>(
      `select c.id from collections c join organizations o on o.id = c.organization_id
        where o.slug = 'pub-c' and c.title = 'Kolekcja testowa jeden'`,
    );

    expect(
      (
        await updateCollection(
          curator,
          id,
          { title: "Tytuł z panelu", version: published!.version },
          makeDeps(appOrm).catalog,
        )
      ).status,
    ).toBe("ok");

    const reports = done(await load(curator, "pub-c", fixture, { publish: true }));

    expect(reports[0]).toMatchObject({
      result: "kept_manual_edit",
      publication: "kept_manual_edit",
    });
    expect((await collectionsOf("pub-c")).map((r) => r.title)).toContain("Tytuł z panelu");

    // A new version of the file: the composition of the edited collection stays
    // as it is and no place is created for the new key.
    const lines = fileLines();

    lines.push({
      ...byKey(lines, "ext:TEST-0003"),
      import_key: "ext:TEST-0004",
      name: "Miejsce testowe czwarte",
    });
    byKey(lines, "col:testowa-jeden").places = ["ext:TEST-0002", "ext:TEST-0001", "ext:TEST-0004"];

    const namesBefore = await placeNamesOf("Tytuł z panelu");
    const placesBefore = (await counts("pub-c")).places;
    const changed = done(await load(curator, "pub-c", fileText(lines), { publish: true }));

    expect(changed[0]).toMatchObject({ result: "kept_manual_edit" });
    expect(await placeNamesOf("Tytuł z panelu")).toEqual(namesBefore);
    expect((await counts("pub-c")).places).toBe(placesBefore);
  });

  it("--publish skips a draft edited by hand and publishes it when untouched", async () => {
    const { curator } = await newOrg("pub-d");

    done(await load(curator, "pub-d", fixture));

    const [{ id, version }] = await admin$<{ id: string; version: number }>(
      `select c.id, c.version from collections c where c.organization_id =
         (select id from organizations where slug = 'pub-d') and c.title = 'Kolekcja testowa jeden'`,
    );

    await updateCollection(
      curator,
      id,
      { title: "Zmieniona ręcznie", version },
      makeDeps(appOrm).catalog,
    );

    const edited = done(await load(curator, "pub-d", fixture, { publish: true }));

    expect(publications(edited)).toEqual(["kept_manual_edit", null]);
    expect((await collectionsOf("pub-d")).every((r) => r.status === "draft")).toBe(true);

    // A composition change in the panel (no version change) also blocks it.
    const text = fixture.replace('"publish":true', '"publish":false');
    const other = await newOrg("pub-e");

    done(await load(other.curator, "pub-e", text));

    const [{ cid }] = await admin$<{ cid: string }>(
      `select c.id as cid from collections c where c.organization_id = $1 and c.title = 'Kolekcja testowa jeden'`,
      [other.id],
    );
    const links = await admin$<{ place_id: string }>(
      `select place_id from collection_places where collection_id = $1 order by position`,
      [cid],
    );

    await reorderPlaces(
      other.curator,
      cid,
      { placeIds: links.map((l) => l.place_id).reverse() },
      makeDeps(appOrm).catalog,
    );

    const reordered = done(await load(other.curator, "pub-e", fixture, { publish: true }));

    expect(publications(reordered)).toEqual(["kept_manual_edit", null]);
    expect((await collectionsOf("pub-e")).every((r) => r.status === "draft")).toBe(true);
  });

  it("--publish refuses a collection without places, keeps the draft and goes on with the rest", async () => {
    const { curator, id } = await newOrg("pub-f");
    const lines = fileLines();
    const empty = {
      type: "collection",
      import_key: "col:pusta",
      title: "Kolekcja pusta",
      summary: "Zostanie bez miejsc.",
      region: "pomorskie",
      places: ["ext:TEST-0003"],
      publish: true,
      review: { status: "approved" },
    };

    // Collection one stays as in the file; the new one holds only TEST-0003.
    lines.splice(
      lines.findIndex((l) => l.type === "place"),
      0,
      empty,
    );
    byKey(lines, "col:testowa-dwa").places = ["ext:TEST-0002"];

    const text = fileText(lines);

    done(await load(curator, "pub-f", text));
    // The only place of the new collection is gone from the organization (a
    // deletion that left the composition recorded as empty).
    const gone = await placeId("pub-f", "Miejsce testowe trzecie");

    await admin$(`delete from collection_places where place_id = $1`, [gone]);
    await admin$(`delete from places where id = $1`, [gone]);
    await admin$(
      `update catalog_import_keys set imported_places = '{}'
        where organization_id = $1 and import_key = 'col:pusta'`,
      [id],
    );

    const reports = done(await load(curator, "pub-f", text, { publish: true }));
    const emptyReport = reports.find((r) => r.importKey === "col:pusta")!;

    expect(emptyReport.publication).toBe("refused");
    expect(emptyReport.publicationRefusal).toMatch(/^unprocessable/);
    expect(publications(reports).filter((p) => p === "published")).toHaveLength(1);

    const rows = await collectionsOf("pub-f");

    expect(rows.find((r) => r.title === "Kolekcja pusta")).toMatchObject({
      status: "draft",
      first_published_at: null,
    });
    expect(rows.find((r) => r.title === "Kolekcja testowa jeden")!.status).toBe("published");
  });

  it("--publish --dry-run lists what it would publish and writes nothing", async () => {
    const { curator } = await newOrg("pub-g");
    const outcome = await load(curator, "pub-g", fixture, { preview: true, publish: true });

    expect(outcome).toMatchObject({
      kind: "preview",
      preview: {
        publishable: [
          expect.objectContaining({
            importKey: "col:testowa-jeden",
            title: "Kolekcja testowa jeden",
          }),
        ],
      },
    });
    expect(await counts("pub-g")).toEqual({ collections: 0, places: 0, keys: 0 });

    const withoutPublish = await load(curator, "pub-g", fixture, { preview: true });

    expect(withoutPublish).toMatchObject({ kind: "preview" });
    expect(withoutPublish).not.toHaveProperty("preview.publishable");
  });

  it("refuses publication and removal to another organization, a suspended one and an account without membership", async () => {
    const owner = await newOrg("pub-h");
    const other = await newOrg("pub-i");
    const suspended = await newOrg("pub-j", true);
    const outsider2 = user("outsider-2");

    await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
      outsider2.id,
      "outsider-2",
      outsider2.email,
    ]);
    done(await load(owner.curator, "pub-h", fixture));

    const before = await collectionsOf("pub-h");

    for (const [actor, slug] of [
      [other.curator, "pub-h"],
      [suspended.curator, "pub-j"],
      [outsider2, "pub-h"],
    ] as const) {
      expect(await load(actor, slug, fixture, { publish: true })).toEqual(refusedOrg);
      expect(await remove(actor, slug)).toEqual(refusedOrg);
    }

    expect(await collectionsOf("pub-h")).toEqual(before);
    expect(await counts("pub-h")).toEqual({ collections: 2, places: 3, keys: 5 });
    expect(await counts("pub-j")).toEqual({ collections: 0, places: 0, keys: 0 });
  });

  it("--remove removes drafts and free places, then a second run is a noop", async () => {
    const { curator } = await newOrg("rem-a");

    done(await load(curator, "rem-a"));

    expect(removal(await remove(curator, "rem-a"))).toEqual([
      "col:testowa-jeden:removed",
      "col:testowa-dwa:removed",
      "ext:TEST-0001:removed",
      "ext:TEST-0002:removed",
      "ext:TEST-0003:removed",
    ]);
    expect(await counts("rem-a")).toEqual({ collections: 0, places: 0, keys: 0 });
    expect(removal(await remove(curator, "rem-a")).every((r) => r.endsWith(":noop"))).toBe(true);
  });

  it("--remove leaves a published collection alone; places of a collection that stays stay", async () => {
    const { curator } = await newOrg("rem-b");

    done(await load(curator, "rem-b", fixture, { publish: true }));
    await admin$(
      `insert into public.saved_collections (user_id, collection_id)
       select $1, c.id from collections c join organizations o on o.id = c.organization_id
        where o.slug = 'rem-b' and c.title = 'Kolekcja testowa jeden'`,
      [explorer.id],
    );

    expect(removal(await remove(curator, "rem-b"))).toEqual([
      "col:testowa-jeden:kept_published",
      "col:testowa-dwa:removed",
      "ext:TEST-0001:kept_in_collection",
      "ext:TEST-0002:kept_in_collection",
      "ext:TEST-0003:removed",
    ]);

    const rows = await collectionsOf("rem-b");

    expect(rows.map((r) => [r.title, r.status])).toEqual([["Kolekcja testowa jeden", "published"]]);
    expect(await counts("rem-b")).toEqual({ collections: 1, places: 2, keys: 3 });
    // The saved-collection entry of an explorer stays with the published collection.
    expect(
      await admin$(`select 1 from saved_collections where user_id = $1`, [explorer.id]),
    ).toHaveLength(1);
    expect(removal(await remove(curator, "rem-b"))).toEqual([
      "col:testowa-jeden:kept_published",
      "col:testowa-dwa:noop",
      "ext:TEST-0001:kept_in_collection",
      "ext:TEST-0002:kept_in_collection",
      "ext:TEST-0003:noop",
    ]);
  });

  it("--remove touches neither a withdrawn collection nor its place with a visit", async () => {
    const { curator } = await newOrg("rem-c");

    done(await load(curator, "rem-c", fixture, { publish: true }));

    const visited = await placeId("rem-c", "Miejsce testowe pierwsze");

    await admin$(
      `insert into public.visits (user_id, place_id, kind, date_precision)
       values ($1, $2, 'past', 'unknown')`,
      [explorer.id, visited],
    );
    // Withdrawn by the owner in the panel: a draft again, address and first publication stay.
    await admin$(
      `update collections set status = 'draft', version = version + 1
        where title = 'Kolekcja testowa jeden' and organization_id =
          (select id from organizations where slug = 'rem-c')`,
    );

    const result = removal(await remove(curator, "rem-c"));

    expect(result.slice(0, 2)).toEqual([
      "col:testowa-jeden:kept_published",
      "col:testowa-dwa:removed",
    ]);
    expect(result).toContain("ext:TEST-0001:kept_in_collection");
    expect(await placeExists(visited)).toBe(true);
    expect((await collectionsOf("rem-c")).map((r) => r.status)).toEqual(["draft"]);
    expect(await admin$(`select 1 from visits where place_id = $1`, [visited])).toHaveLength(1);
  });

  it("--remove keeps a place with a visit or on a want-to-see list outside every collection (23503) and goes on", async () => {
    const { curator } = await newOrg("rem-d");

    done(await load(curator, "rem-d"));

    const visited = await placeId("rem-d", "Miejsce testowe trzecie");
    const wanted = await placeId("rem-d", "Miejsce testowe pierwsze");

    await admin$(
      `insert into public.visits (user_id, place_id, kind, date_precision)
       values ($1, $2, 'past', 'unknown')`,
      [explorer.id, visited],
    );
    await admin$(`insert into public.want_to_see_places (user_id, place_id) values ($1, $2)`, [
      explorer.id,
      wanted,
    ]);

    // The place with a want-to-see entry comes first in the file: after its 23503
    // the transaction must still delete the free place that follows.
    expect(removal(await remove(curator, "rem-d"))).toEqual([
      "col:testowa-jeden:removed",
      "col:testowa-dwa:removed",
      "ext:TEST-0001:kept_referenced",
      "ext:TEST-0002:removed",
      "ext:TEST-0003:kept_referenced",
    ]);
    expect(await counts("rem-d")).toEqual({ collections: 0, places: 2, keys: 2 });
    expect(
      removal(await remove(curator, "rem-d")).filter((r) => r.endsWith("kept_referenced")),
    ).toHaveLength(2);
  });

  it("--remove keeps a place that another collection of the organization holds", async () => {
    const { curator } = await newOrg("rem-e");
    const second = [
      batchLine,
      JSON.stringify({
        type: "collection",
        import_key: "col:inna",
        title: "Kolekcja inna",
        summary: "Zawiera miejsce z pierwszego pliku.",
        region: "pomorskie",
        places: ["ext:TEST-0003"],
        review: { status: "approved" },
      }),
    ].join("\n");

    done(await load(curator, "rem-e"));
    done(await load(curator, "rem-e", second));

    expect(removal(await remove(curator, "rem-e"))).toEqual([
      "col:testowa-jeden:removed",
      "col:testowa-dwa:removed",
      "ext:TEST-0001:removed",
      "ext:TEST-0002:removed",
      "ext:TEST-0003:kept_in_collection",
    ]);
    expect((await collectionsOf("rem-e")).map((r) => r.title)).toEqual(["Kolekcja inna"]);

    // A file with keys of other loads only removes the draft collection.
    expect(removal(await remove(curator, "rem-e", second))).toEqual(["col:inna:removed"]);
    expect(await counts("rem-e")).toEqual({ collections: 0, places: 1, keys: 1 });
  });

  it("--remove rolls everything back when a use case refuses halfway", async () => {
    const { curator } = await newOrg("rem-g");

    done(await load(curator, "rem-g"));

    const deps = makeDeps(appOrm);
    let reserved = 0;
    const refusing: CatalogImportDeps = {
      ...deps,
      catalog: {
        ...deps.catalog,
        // The first collection is deleted, the second one is refused.
        limiter: {
          reserve: async () =>
            ++reserved === 1 ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 },
        },
      },
    };
    const before = await counts("rem-g");
    const outcome = await executeCatalogRemove(
      { actor: curator, orgSlug: "rem-g", file: parse(fixture) },
      refusing,
    );

    expect(outcome).toEqual({ kind: "refused", code: "removal_refused", reason: "rate_limited" });
    expect(reserved).toBe(2);
    expect(await counts("rem-g")).toEqual(before);
    expect(await collectionsOf("rem-g")).toHaveLength(2);
  });

  it("--remove removes keys of entities deleted in the panel", async () => {
    const { curator } = await newOrg("rem-f");

    done(await load(curator, "rem-f"));

    const deps = makeDeps(appOrm).catalog;
    const [{ id }] = await admin$<{ id: string }>(
      `select id from collections where title = 'Kolekcja testowa dwa' and organization_id =
         (select id from organizations where slug = 'rem-f')`,
    );

    expect((await deleteDraftCollection(curator, id, deps)).status).toBe("ok");

    // TEST-0003 is gone from the organization, together with its link.
    const gone = await placeId("rem-f", "Miejsce testowe trzecie");

    await admin$(`delete from places where id = $1`, [gone]);

    expect(removal(await remove(curator, "rem-f"))).toEqual([
      "col:testowa-jeden:removed",
      "col:testowa-dwa:orphan_key_removed",
      "ext:TEST-0001:removed",
      "ext:TEST-0002:removed",
      "ext:TEST-0003:orphan_key_removed",
    ]);
    expect(await counts("rem-f")).toEqual({ collections: 0, places: 0, keys: 0 });
    expect(removal(await remove(curator, "rem-f")).every((r) => r.endsWith(":noop"))).toBe(true);
  });
});
