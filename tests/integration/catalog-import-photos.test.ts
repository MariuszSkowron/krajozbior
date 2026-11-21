import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  executeCatalogImport,
  executeCatalogRemove,
  type ValidImportFile,
} from "@/features/catalog/application/catalog-import";
import type {
  CatalogImportDeps,
  CatalogImportOutcome,
  PlaceReport,
} from "@/features/catalog/application/catalog-import-types";
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

// The photo block of a place in the collection file (E4-2a), on the real database as
// krajozbior_app: a row `commons_import` / `pending_fetch` without a file, a second load changes
// nothing, a change of the file reaches the row, an edit or a delete made by the curator stays,
// a block that went (or a new Commons file) removes the row, a licence outside the list is skipped.
const fixture = readFileSync("tests/fixtures/curation/minimal.ndjson", "utf8");

// Loose on purpose: the tests edit the parsed records of the fixture.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

let db: ScratchDatabase;
let orm: MikroORM;

const curator = { id: randomUUID(), role: "user" as const, email: "cur@example.com" };
let counter = 0;

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

const deps: () => CatalogImportDeps = () => ({
  catalog: {
    withUserContext: (actor, work) => runInUserContext(orm.em, actor, work),
    withGuestContext: (work) => runInGuestContext(orm.em, work),
    limiter: { reserve: async () => ({ allowed: true }) },
    repository: postgresCatalogRepository,
    random: (max) => randomInt(max),
  },
  imports: postgresCatalogImportRepository,
});

const edited = (change: (items: Rec[]) => void): string => {
  const items = fixture
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Rec);

  change(items);

  return items.map((item) => JSON.stringify(item)).join("\n") + "\n";
};

const parse = (text: string): ValidImportFile => {
  const result = parseImportFile(text);

  if (!result.ok) {
    throw new Error(`fixture invalid: ${JSON.stringify(result.errors)}`);
  }

  return result;
};

// A fresh organization per scenario (the curator belongs to all of them).
const newOrganization = async (): Promise<string> => {
  const slug = `ph-${(counter += 1)}`;
  const [{ id }] = await admin$<{ id: string }>(
    `insert into public.organizations (name, slug, kind) values ($1, $1, 'municipality') returning id`,
    [slug],
  );

  await admin$(
    `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
    [id, curator.id],
  );

  return slug;
};

const load = (slug: string, text = fixture, preview = false) =>
  executeCatalogImport(
    { actor: curator, orgSlug: slug, file: parse(text), preview, publish: false },
    deps(),
  );

const placeReports = (outcome: CatalogImportOutcome): PlaceReport[] => {
  if (outcome.kind !== "done") {
    throw new Error(`expected done, got ${outcome.kind}`);
  }

  return outcome.collections.flatMap((collection) => [...collection.places]);
};

const photosOf = (outcome: CatalogImportOutcome) =>
  placeReports(outcome).flatMap((place) => (place.photos === undefined ? [] : [...place.photos]));

type PhotoRow = {
  id: string;
  file_state: string;
  source_kind: string;
  storage_key: string | null;
  license_code: string;
  license_url: string;
  license_label: string;
  source_width: number;
  position: number;
  version: number;
  author_text: string;
  alt_text: string;
  rights_statement: string;
  created_by: string;
  commons_file: string;
};

const rows = (slug: string) =>
  admin$<PhotoRow>(
    `select ph.* from public.place_photos ph join public.organizations o on o.id = ph.organization_id
      where o.slug = $1 order by ph.created_at, ph.position`,
    [slug],
  );

const photoKeys = async (slug: string) =>
  (
    await admin$<{ n: number }>(
      `select count(*)::int as n from public.catalog_import_keys k
         join public.organizations o on o.id = k.organization_id
        where o.slug = $1 and k.entity_kind = 'photo'`,
      [slug],
    )
  )[0]!.n;

const asCurator = (sql: string, params: unknown[] = []) =>
  runInUserContext(orm.em, curator, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));

describe("the photo block in the collection file", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_catalog_photos");
    await db.migrate();
    await admin$(`insert into auth.users (id, name, email) values ($1, 'cur', $2)`, [
      curator.id,
      curator.email,
    ]);
    orm = await MikroORM.init(createOrmConfig(db.urls.krajozbior_app));
  }, 60_000);

  afterAll(async () => {
    await orm?.close(true);
    await db?.drop();
  });

  it("previews the photo and writes nothing", async () => {
    const slug = await newOrganization();
    const outcome = await load(slug, fixture, true);

    expect(outcome).toMatchObject({ kind: "preview", preview: { photos: { created: 1 } } });
    expect(await rows(slug)).toEqual([]);
  });

  it("creates a row without a file, with the canonical licence, and a key", async () => {
    const slug = await newOrganization();
    const outcome = await load(slug);

    expect(photosOf(outcome)).toEqual(["created"]);

    const [row, ...rest] = await rows(slug);

    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      file_state: "pending_fetch",
      source_kind: "commons_import",
      storage_key: null,
      license_code: "cc-by-sa-4.0",
      license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
      license_label: "CC BY-SA 4.0",
      source_width: 1600,
      position: 1,
      version: 1,
      author_text: "Autor Testowy",
      alt_text: "Miejsce testowe pierwsze",
      rights_statement: "commons-import/1",
      created_by: curator.id,
      commons_file: "Miejsce testowe pierwsze.jpg",
    });
    expect(await photoKeys(slug)).toBe(1);
  });

  it("a second load changes nothing", async () => {
    const slug = await newOrganization();

    await load(slug);

    const before = await rows(slug);

    expect(photosOf(await load(slug))).toEqual(["noop"]);
    expect(await rows(slug)).toEqual(before);
    expect(await photoKeys(slug)).toBe(1);
  });

  it("brings a change of the file to the row (author, licence and its label)", async () => {
    const slug = await newOrganization();

    await load(slug);

    const changed = edited((items) => {
      items[3]!.image.author_text = "Inny Autor";
      items[3]!.image.license_short = "CC BY-SA 3.0 pl";
      items[3]!.image.license_url = "https://creativecommons.org/licenses/by-sa/3.0/pl/deed.en";
    });

    expect(photosOf(await load(slug, changed))).toEqual(["updated"]);

    const [row] = await rows(slug);

    expect(row).toMatchObject({
      author_text: "Inny Autor",
      license_code: "cc-by-sa-3.0",
      license_url: "https://creativecommons.org/licenses/by-sa/3.0/pl/",
      license_label: "CC BY-SA 3.0 PL",
      version: 2,
    });
    expect(photosOf(await load(slug, changed))).toEqual(["noop"]);
  });

  it("keeps what the curator edited in the panel", async () => {
    const slug = await newOrganization();

    await load(slug);

    const [row] = await rows(slug);

    await asCurator(
      `update public.place_photos set alt_text = 'Ręczny opis', version = version + 1 where id = ?`,
      [row!.id],
    );

    const changed = edited((items) => {
      items[3]!.image.author_text = "Inny Autor";
    });

    expect(photosOf(await load(slug, changed))).toEqual(["kept_manual_edit"]);
    expect(await rows(slug)).toMatchObject([
      { alt_text: "Ręczny opis", author_text: "Autor Testowy" },
    ]);
  });

  it("does not bring back a photo the curator deleted", async () => {
    const slug = await newOrganization();

    await load(slug);

    const [row] = await rows(slug);

    await asCurator(`delete from public.place_photos where id = ?`, [row!.id]);

    expect(photosOf(await load(slug))).toEqual(["kept_manual_delete"]);
    expect(await rows(slug)).toEqual([]);
  });

  it("removes the row when the block goes from the file, unless it was edited by hand", async () => {
    const slug = await newOrganization();
    const without = edited((items) => {
      delete items[3]!.image;
    });

    await load(slug);
    expect(photosOf(await load(slug, without))).toEqual(["removed"]);
    expect(await rows(slug)).toEqual([]);
    expect(await photoKeys(slug)).toBe(0);

    const kept = await newOrganization();

    await load(kept);

    const [row] = await rows(kept);

    await asCurator(`update public.place_photos set version = version + 1 where id = ?`, [row!.id]);

    expect(photosOf(await load(kept, without))).toEqual(["kept_manual_edit"]);
    expect(await rows(kept)).toHaveLength(1);
  });

  it("replaces the row when the Commons file changes", async () => {
    const slug = await newOrganization();

    await load(slug);

    const swapped = edited((items) => {
      items[3]!.image.commons_file = "Zupełnie inny plik.jpg";
      items[3]!.image.title = "Inny tytuł";
    });

    expect(photosOf(await load(slug, swapped))).toEqual(["removed", "created"]);
    expect(await rows(slug)).toMatchObject([
      { commons_file: "Zupełnie inny plik.jpg", alt_text: "Inny tytuł", position: 1 },
    ]);
    expect(await photoKeys(slug)).toBe(1);
  });

  it("loads the place but skips a licence outside the list", async () => {
    const slug = await newOrganization();
    const nonCommercial = edited((items) => {
      items[3]!.image.license_short = "CC BY-NC 4.0";
      items[3]!.image.license_url = "https://creativecommons.org/licenses/by-nc/4.0";
    });
    const outcome = await load(slug, nonCommercial);

    expect(photosOf(outcome)).toEqual(["skipped_unknown_license"]);
    expect(placeReports(outcome).map((place) => place.result)).toContain("created");
    expect(await rows(slug)).toEqual([]);
  });

  it("does not add a second row for a Commons file the place already has", async () => {
    const slug = await newOrganization();

    await load(slug);
    // The key goes (as after a loss of the keys); the file stays: the row is not doubled.
    await admin$(
      `delete from public.catalog_import_keys k using public.organizations o
        where o.id = k.organization_id and o.slug = $1 and k.entity_kind = 'photo'`,
      [slug],
    );

    expect(photosOf(await load(slug))).toEqual(["noop"]);
    expect(await rows(slug)).toHaveLength(1);
  });

  it("removes the rows and keys of a removed place (--remove)", async () => {
    const slug = await newOrganization();

    await load(slug);

    const outcome = await executeCatalogRemove(
      { actor: curator, orgSlug: slug, file: parse(fixture) },
      deps(),
    );

    expect(outcome.kind).toBe("removed");
    expect(await rows(slug)).toEqual([]);
    expect(await photoKeys(slug)).toBe(0);
  });
});
