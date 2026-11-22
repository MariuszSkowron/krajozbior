import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  executeCatalogImport,
  type ValidImportFile,
} from "@/features/catalog/application/catalog-import";
import type {
  CatalogImportDeps,
  CollectionReport,
} from "@/features/catalog/application/catalog-import-types";
import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { addPlace, updatePlace } from "@/features/catalog/application/curator-places";
import { getPublishedPlace } from "@/features/catalog/application/public-catalog";
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

// E1-S11 (R-14): the column `places.access_restriction` on a real database as
// krajozbior_app. The place is public data of the curator, so the rule is the
// one of the other columns of `places`: only a member of the organization with
// full edit writes it; a guest, an explorer and a curator of another
// organization write nothing. The loader carries the value from the file.
const fixture = readFileSync("tests/fixtures/curation/minimal.ndjson", "utf8");
const rejectedByPolicy = /row-level security/;

let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({
  id: randomUUID(),
  role: "user" as const,
  email: `${name}@example.com`,
});
const curA = user("cur-a");
const curB = user("cur-b");
const explorer = user("explorer");
const curL = user("cur-l");
const actors = [curA, curB, explorer, curL];

let orgA = "";

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
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
const importDeps: CatalogImportDeps = { catalog: deps, imports: postgresCatalogImportRepository };

const restrictionOf = async (placeId: string) =>
  (
    await admin$<{ access_restriction: string }>(
      `select access_restriction from public.places where id = $1`,
      [placeId],
    )
  )[0]!.access_restriction;

// A published collection holding the place, so that a guest can read the place.
async function publishedPlace(restriction = "none"): Promise<string> {
  const placeId = (
    await as(
      curA,
      `insert into public.places (organization_id, name, latitude, longitude, access_restriction)
       values (?, 'Miejsce', 54.1, 18.7, ?) returning id`,
      [orgA, restriction],
    )
  )[0]!.id as string;
  const collectionId = (
    await as(
      curA,
      `insert into public.collections (slug, organization_id, title, region)
       values (?, ?, 'Kolekcja', 'pomorskie') returning id`,
      [`kolekcja-${randomUUID().slice(0, 8)}`, orgA],
    )
  )[0]!.id as string;

  await as(
    curA,
    `insert into public.collection_places (collection_id, place_id, organization_id, position)
     values (?, ?, ?, 1)`,
    [collectionId, placeId, orgA],
  );
  await as(curA, `update public.collections set status = 'published' where id = ?`, [collectionId]);

  return placeId;
}

describe("access restriction of a place", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_place_access");
    await db.migrate();

    for (const { id, email } of actors) {
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
    await org("gmina-b", curB);
    await org("gmina-l", curL);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("defaults to none for a place written without the column (existing rows keep working)", async () => {
    const placeId = (
      await as(
        curA,
        `insert into public.places (organization_id, name, latitude, longitude)
         values (?, 'Stare miejsce', 54.1, 18.7) returning id`,
        [orgA],
      )
    )[0]!.id as string;

    expect(await restrictionOf(placeId)).toBe("none");
  });

  it("refuses any value outside the list (CHECK)", async () => {
    await expect(
      admin$(
        `insert into public.places (organization_id, name, latitude, longitude, access_restriction)
         values ($1, 'x', 1, 1, 'closed')`,
        [orgA],
      ),
    ).rejects.toThrow(/access_restriction/);
  });

  it("lets a curator set and change it through the use cases, and a guest reads it", async () => {
    const draftId = (
      await as(
        curA,
        `insert into public.collections (slug, organization_id, title, region)
         values (?, ?, 'Szkic', 'pomorskie') returning id`,
        [`szkic-${randomUUID().slice(0, 8)}`, orgA],
      )
    )[0]!.id as string;
    const created = await addPlace(
      curA,
      draftId,
      { name: "Nowe", latitude: 54, longitude: 18, accessRestriction: "private" },
      deps,
    );

    expect(created).toMatchObject({ status: "ok" });
    expect(
      (
        await admin$<{ access_restriction: string }>(
          `select access_restriction from public.places where name = 'Nowe'`,
        )
      )[0]!.access_restriction,
    ).toBe("private");
    expect(
      await addPlace(
        curA,
        draftId,
        { name: "Zle", latitude: 54, longitude: 18, accessRestriction: "x" },
        deps,
      ),
    ).toEqual({ status: "invalid", errors: ["accessRestriction"] });

    const placeId = await publishedPlace("fenced");
    const read = await getPublishedPlace(placeId, deps);

    expect(read).toMatchObject({ status: "ok", value: { accessRestriction: "fenced" } });

    const [{ version }] = await admin$<{ version: number }>(
      `select version from public.places where id = $1`,
      [placeId],
    );
    const updated = await updatePlace(curA, placeId, { version, accessRestriction: "ruin" }, deps);

    expect(updated).toMatchObject({ status: "ok", value: { accessRestriction: "ruin" } });
    expect(await restrictionOf(placeId)).toBe("ruin");
    expect(await getPublishedPlace(placeId, deps)).toMatchObject({
      value: { accessRestriction: "ruin" },
    });
  });

  it("keeps the stored value when an update does not name the field, and refuses an unknown one", async () => {
    const placeId = await publishedPlace("private");
    const [{ version }] = await admin$<{ version: number }>(
      `select version from public.places where id = $1`,
      [placeId],
    );

    expect(await updatePlace(curA, placeId, { version, name: "Inna nazwa" }, deps)).toMatchObject({
      status: "ok",
      value: { accessRestriction: "private" },
    });
    expect(
      await updatePlace(curA, placeId, { version: version + 1, accessRestriction: "x" }, deps),
    ).toEqual({ status: "invalid", errors: ["accessRestriction"] });
    expect(await restrictionOf(placeId)).toBe("private");
  });

  it("refuses to write it: no context, an explorer, an account of another organization", async () => {
    const placeId = await publishedPlace("none");
    const [{ version }] = await admin$<{ version: number }>(
      `select version from public.places where id = $1`,
      [placeId],
    );

    // A guest transaction is read only; a bare connection has no policy to pass.
    await expect(
      asGuest(`update public.places set access_restriction = 'ruin' where id = ?`, [placeId]),
    ).rejects.toThrow(/read-only/);
    await expect(
      app.em.execute(`update public.places set access_restriction = 'ruin' where id = ?`, [
        placeId,
      ]),
    ).resolves.toBeDefined();
    expect(await restrictionOf(placeId)).toBe("none");

    // An explorer and a curator of another organization see the place but change 0 rows.
    for (const actor of [explorer, curB]) {
      expect(
        await as(
          actor,
          `update public.places set access_restriction = 'ruin' where id = ? returning id`,
          [placeId],
        ),
      ).toHaveLength(0);
      await expect(
        as(
          actor,
          `insert into public.places (organization_id, name, latitude, longitude, access_restriction)
           values (?, 'x', 1, 1, 'private')`,
          [orgA],
        ),
      ).rejects.toThrow(rejectedByPolicy);
    }

    // The use cases answer the same way: not found for another organization, forbidden for an explorer.
    expect(await updatePlace(curB, placeId, { version, accessRestriction: "ruin" }, deps)).toEqual({
      status: "not_found",
    });
    expect(
      await updatePlace(explorer, placeId, { version, accessRestriction: "ruin" }, deps),
    ).toEqual({ status: "forbidden" });
    expect(await restrictionOf(placeId)).toBe("none");
  });

  it("gives the column to krajozbior_app only, and no write to the other roles", async () => {
    const [p] = await admin$<Record<string, boolean>>(
      `select
         has_column_privilege('krajozbior_app', 'places', 'access_restriction', 'select, insert, update') as app_all,
         has_column_privilege('krajozbior_auth', 'places', 'access_restriction', 'select, insert, update') as auth_any,
         has_column_privilege('krajozbior_ops', 'places', 'access_restriction', 'select, insert, update') as ops_any`,
    );

    expect(p).toEqual({ app_all: true, auth_any: false, ops_any: false });
  });

  describe("loading it from a file", () => {
    const parse = (text: string): ValidImportFile => {
      const result = parseImportFile(text);

      if (!result.ok) {
        throw new Error(`fixture invalid: ${JSON.stringify(result.errors)}`);
      }

      return result;
    };
    const lines = () =>
      fixture
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
    const text = (items: Record<string, unknown>[]) =>
      items.map((l) => JSON.stringify(l)).join("\n");
    const load = (content: string) =>
      executeCatalogImport(
        { actor: curL, orgSlug: "gmina-l", file: parse(content), preview: false, publish: false },
        importDeps,
      );
    const placeResults = (outcome: Awaited<ReturnType<typeof load>>): string[] => {
      if (outcome.kind !== "done") {
        throw new Error(`expected done, got ${outcome.kind}`);
      }

      return outcome.collections.flatMap((c: CollectionReport) => c.places.map((p) => p.result));
    };
    const stored = async () =>
      Object.fromEntries(
        (
          await admin$<{ name: string; access_restriction: string; version: number }>(
            `select p.name, p.access_restriction, p.version from public.places p
               join public.organizations o on o.id = p.organization_id
              where o.slug = 'gmina-l'`,
          )
        ).map((row) => [row.name, row]),
      );

    it("stores the value of the file, updates an untouched place on a reload and leaves a hand-edited one", async () => {
      const first = lines();

      first.find((l) => l.import_key === "ext:TEST-0001")!.access = {
        note: "Teren ogólnodostępny.",
        restriction: "private",
      };
      await load(text(first));

      expect((await stored())["Miejsce testowe pierwsze"]).toMatchObject({
        access_restriction: "private",
      });
      expect((await stored())["Miejsce testowe drugie"]).toMatchObject({
        access_restriction: "none",
      });

      // A curator edits the second place in the panel (version moves).
      const second = (await stored())["Miejsce testowe drugie"]!;
      const [{ id: secondId }] = await admin$<{ id: string }>(
        `select id from public.places where name = 'Miejsce testowe drugie'`,
      );

      await updatePlace(
        curL,
        secondId!,
        { version: second.version, address: "Adres z panelu" },
        deps,
      );

      // New version of the file: the first place becomes a ruin, the second a fenced place.
      const next = lines();

      next.find((l) => l.import_key === "ext:TEST-0001")!.access = {
        note: "Teren ogólnodostępny.",
        restriction: "ruin",
      };
      next.find((l) => l.import_key === "ext:TEST-0002")!.access = {
        note: "Wejście od ulicy testowej.",
        restriction: "fenced",
      };

      const results = placeResults(await load(text(next)));

      expect(results).toContain("updated");
      expect(results).toContain("kept_manual_edit");

      const after = await stored();

      expect(after["Miejsce testowe pierwsze"]).toMatchObject({ access_restriction: "ruin" });
      expect(after["Miejsce testowe drugie"]).toMatchObject({ access_restriction: "none" });

      // Loading the same file again changes nothing.
      const again = await stored();

      await load(text(next));
      expect(await stored()).toEqual(again);
    });
  });
});
