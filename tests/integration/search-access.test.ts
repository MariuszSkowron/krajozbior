import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import {
  listAllPublishedCollections,
  searchPublicCatalog,
  type SearchOutcome,
} from "@/features/catalog/application/public-search";
import { foldSearchText, foldSql } from "@/features/catalog/domain/search";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { FOLD_CASES } from "../support/search-fold-cases";

// E12-2: what the public search returns. The use cases run in the guest context on a pool
// of one connection as krajozbior_app (RLS on), so a context leaked from a curator's
// transaction would show. A draft, a withdrawn collection, a collection of a suspended
// organization and a place that lies only in such a collection never appear, for a guest and
// for the curator who owns them alike (the search has no actor: the same answer for all).
let db: ScratchDatabase;
let app: MikroORM;

const curator = { id: randomUUID(), email: "cur-search@example.com" };
let orgId = "";
let suspendedOrgId = "";

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const asCurator = (sql: string, params: unknown[] = []) =>
  runInUserContext(app.em, curator, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));

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
  options: {
    organization?: string;
    status?: "draft" | "published";
    region?: string;
    summary?: string;
  } = {},
) {
  counter += 1;

  return (
    await admin$<{ id: string }>(
      `insert into public.collections (slug, organization_id, title, summary, region, status)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        `szukaj-${counter}`,
        options.organization ?? orgId,
        title,
        options.summary ?? "",
        options.region ?? "pomorskie",
        options.status ?? "published",
      ],
    )
  )[0]!.id;
}

async function place(
  name: string,
  collections: readonly string[],
  organization = orgId,
  address = "Tczew",
) {
  const id = (
    await admin$<{ id: string }>(
      `insert into public.places (organization_id, name, address, latitude, longitude)
       values ($1, $2, $3, 54.09, 18.79) returning id`,
      [organization, name, address],
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

async function search(phrase: string, region?: string): Promise<SearchOutcome> {
  return searchPublicCatalog(phrase, region, deps);
}

const titles = (outcome: SearchOutcome) =>
  outcome.status === "ok" ? outcome.collections.map((c) => c.title) : [];
const names = (outcome: SearchOutcome) =>
  outcome.status === "ok" ? outcome.places.map((p) => p.name) : [];

describe("public search (guest context, RLS on)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_search");
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

    orgId = await org("Gmina Szukająca", "gmina-szukajaca");
    suspendedOrgId = await org("Gmina Zawieszona", "gmina-zawieszona");
    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [orgId, curator.id],
    );
    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [suspendedOrgId, curator.id],
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

  it("finds a published collection and its place by a phrase without Polish letters or capitals", async () => {
    const wieza = await collection("Wieża ciśnień i inne", {
      summary: "Szlak po żuławskich wieżach",
    });

    await place("Wieża w Tczewie", [wieza], orgId, "ul. Łąkowa 1, Tczew");

    for (const phrase of ["wieza", "WIEZA", "Wieża", "wież", "  wieza  "]) {
      const outcome = await search(phrase);

      expect(titles(outcome), phrase).toContain("Wieża ciśnień i inne");
      expect(names(outcome), phrase).toContain("Wieża w Tczewie");
    }

    // The summary and the address are searched, the description is not.
    expect(titles(await search("zulawskich"))).toContain("Wieża ciśnień i inne");
    expect(names(await search("LAKOWA"))).toContain("Wieża w Tczewie");

    const outcome = await search("wieza");

    expect(outcome).toMatchObject({ status: "ok", phrase: "wieza", moreCollections: false });
    expect(outcome.status === "ok" && outcome.places[0]?.collection.title).toBe(
      "Wieża ciśnień i inne",
    );
  });

  it("finds Łódź by lodz and Żuławy by ŻUŁAWY, and a region by the start of its name", async () => {
    await collection("Łódź fabryk", { region: "lodzkie" });
    await collection("Żuławy", { region: "pomorskie" });
    await collection("Bez nazwy regionu w tytule", { region: "malopolskie" });

    expect(titles(await search("lodz"))).toContain("Łódź fabryk");
    expect(titles(await search("ŁÓDŹ"))).toContain("Łódź fabryk");
    expect(titles(await search("ŻUŁAWY"))).toEqual(["Żuławy"]);
    // "Małopolskie" is the region of a collection whose title does not say so.
    expect(titles(await search("malopol"))).toContain("Bez nazwy regionu w tytule");
    expect(titles(await search("pomorskie"))).toContain("Żuławy");
  });

  it("puts titles starting with the phrase first and filters by region", async () => {
    await collection("Bunkry. Zamek na wzgórzu", { region: "slaskie" });
    await collection("Zamek Królewski", { region: "mazowieckie" });
    await collection("Zamki Gotyckie", { region: "slaskie" });

    const all = await search("zamek");

    expect(titles(all).slice(0, 1)).toEqual(["Zamek Królewski"]);
    expect(titles(all)).toContain("Bunkry. Zamek na wzgórzu");

    const silesian = await search("zamek", "slaskie");

    expect(titles(silesian)).toEqual(["Bunkry. Zamek na wzgórzu"]);
    expect(titles(await search("zamek", "nie-ma-takiego"))).toEqual(titles(all));
  });

  it("does not show a draft, a withdrawn collection, one of a suspended organization or a place only in them", async () => {
    const draft = await collection("Kometa szkic", { status: "draft" });
    const withdrawn = await collection("Kometa wycofana");
    const suspended = await collection("Kometa zawieszonej", { organization: suspendedOrgId });
    const hiddenPlace = await place("Kometa tylko w szkicu", [draft, withdrawn], orgId, "Kometa");
    const suspendedPlace = await place("Kometa w zawieszonej", [suspended], suspendedOrgId);

    await admin$(`update public.collections set status = 'draft' where id = $1`, [withdrawn]);

    // The curator owns the draft and the withdrawn collection and reads them through the row
    // policies (the one of the suspended organization is shown before the suspension)...
    const own = await asCurator(
      `select title from public.collections where title like 'Kometa%' order by title`,
    );

    expect(own.map((row) => row.title)).toEqual([
      "Kometa szkic",
      "Kometa wycofana",
      "Kometa zawieszonej",
    ]);

    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [
      suspendedOrgId,
    ]);

    // ...but the search gives nobody anything, and the same right after the curator's transaction.
    const asGuest = await search("kometa");

    expect(asGuest).toMatchObject({ status: "ok", collections: [], places: [] });
    expect(await search("kometa")).toEqual(asGuest);
    expect(JSON.stringify(asGuest)).not.toContain(hiddenPlace);
    expect(JSON.stringify(asGuest)).not.toContain(suspendedPlace);
    expect(
      (await listAllPublishedCollections(undefined, deps)).collections.map((c) => c.title),
    ).not.toContain("Kometa szkic");
  });

  it("shows a place that lies in a draft and in a public collection, with the title of the public one", async () => {
    const draft = await collection("Aaa szkic dwa", { status: "draft" });
    const open = await collection("Zzz publiczna dwa");

    await place("Latarnia podwójna", [draft, open]);

    const outcome = await search("latarnia");

    expect(names(outcome)).toEqual(["Latarnia podwójna"]);
    expect(outcome.status === "ok" && outcome.places[0]?.collection.title).toBe(
      "Zzz publiczna dwa",
    );
  });

  it("treats % _ and the backslash as ordinary characters", async () => {
    await collection("Rabat 100% gwarancji");
    await collection("Znak_podkreślenia");

    expect(titles(await search("%%"))).toEqual([]);
    expect(titles(await search("__"))).toEqual([]);
    expect(titles(await search("\\\\"))).toEqual([]);
    expect(titles(await search("100%"))).toEqual(["Rabat 100% gwarancji"]);
    expect(titles(await search("z_ak"))).toEqual([]);
    expect(titles(await search("znak_p"))).toEqual(["Znak_podkreślenia"]);
  });

  // The ORM quotes the values itself, so the protection rests on two conditions at once:
  // only values go into a query, and the library quotes them (docs/engineering.md).
  it("finds a phrase made of quote, backslash, question mark, colon and dollar characters as plain text", async () => {
    await collection("Dom o'Brien i ? pytania");
    await collection("Ścieżka a\\b i :nazwa oraz $1");
    await collection("Komentarz -- koniec; drop table x");

    for (const [phrase, expected] of [
      ["o'brien", ["Dom o'Brien i ? pytania"]],
      ["i ? p", ["Dom o'Brien i ? pytania"]],
      ["a\\b", ["Ścieżka a\\b i :nazwa oraz $1"]],
      [":nazwa", ["Ścieżka a\\b i :nazwa oraz $1"]],
      ["oraz $1", ["Ścieżka a\\b i :nazwa oraz $1"]],
      ["-- koniec; drop", ["Komentarz -- koniec; drop table x"]],
      ["'; drop table collections; --", []],
      ["' or '1'='1", []],
    ] as const) {
      expect(titles(await search(phrase)), phrase).toEqual(expected);
    }

    // The table is still there (the phrases were not executed as SQL).
    expect(
      (await admin$<{ n: string }>("select count(*)::text as n from public.collections"))[0]!.n,
    ).not.toBe("0");
  });

  it("rejects a phrase of 81 characters and of 1 character before the database", async () => {
    const throwing: CatalogDeps = {
      ...deps,
      withGuestContext: () => {
        throw new Error("database reached");
      },
    };

    expect(await searchPublicCatalog("a".repeat(81), undefined, throwing)).toMatchObject({
      status: "invalid",
      reason: "too_long",
    });
    expect(await searchPublicCatalog("a", undefined, throwing)).toMatchObject({
      status: "invalid",
      reason: "too_short",
    });
    expect((await search("a".repeat(80))).status).toBe("ok");
  });

  it("gives the same answer in SQL and in TypeScript for the folding table", async () => {
    for (const [text, folded] of FOLD_CASES) {
      const rows = await admin$<{ folded: string }>(`select ${foldSql("$1::text")} as folded`, [
        text,
      ]);

      expect(rows[0]!.folded, text).toBe(folded);
      expect(foldSearchText(text), text).toBe(folded);
    }
  });

  it("works whatever the collation of the database does with capital Polish letters", async () => {
    const rows = await admin$<{ folded: string }>(
      `select ${foldSql("(select 'ŁÓDŹ' collate \"C\")")} as folded`,
    );

    expect(rows[0]!.folded).toBe("lodz");
  });

  it("does not find text stored decomposed (NFD): documented behaviour (D-E12-3)", async () => {
    const composed = "Wieża komponowana";
    const decomposed = "Wieża rozłożona";
    const id = await collection("Kolekcja dla NFD");

    await place(composed, [id]);
    await place(decomposed, [id]);

    expect(names(await search("wieza komponowana"))).toEqual([composed]);
    expect(names(await search("wieza rozlozona"))).toEqual([]);
  });

  it("reads at most 20 of each kind and says there is more", async () => {
    await admin$(
      `insert into public.collections (slug, organization_id, title, region, status)
       select 'masowa-' || n, $1, 'Masowa ' || lpad(n::text, 2, '0'), 'opolskie', 'published'
         from generate_series(1, 21) n`,
      [orgId],
    );

    const outcome = await search("masowa");

    expect(outcome).toMatchObject({ status: "ok", moreCollections: true, morePlaces: false });
    expect(titles(outcome)).toHaveLength(20);
    expect(titles(outcome)[0]).toBe("Masowa 01");
    expect((await search("masowa", "slaskie")).status === "ok").toBe(true);
    expect(titles(await search("masowa", "slaskie"))).toEqual([]);
  });

  it("lists all published collections alphabetically, optionally of one region", async () => {
    const all = await listAllPublishedCollections(undefined, deps);
    const opole = await listAllPublishedCollections("opolskie", deps);

    expect(all.region).toBeNull();
    expect(all.collections.length).toBeGreaterThan(21);
    expect(all.collections.map((c) => c.title)).toEqual(
      [...all.collections.map((c) => c.title)].sort((a, b) => a.localeCompare(b, "pl")),
    );
    expect(opole.region).toBe("opolskie");
    expect(opole.collections).toHaveLength(21);
    expect(all.collections.some((c) => c.title.startsWith("Kometa"))).toBe(false);
  });

  it("sets a time limit of 2 s for the search transaction only", async () => {
    const inside = await runInGuestContext(app.em, async (tx) => {
      await postgresCatalogRepository.searchPublicCatalog(
        tx,
        { contains: "%x%", prefix: "x%", namedRegions: [], region: null },
        20,
      );

      return (await tx.em.execute<{ statement_timeout: string }[]>(`show statement_timeout`))[0]!
        .statement_timeout;
    });
    const after = await runInGuestContext(
      app.em,
      async (tx) =>
        (await tx.em.execute<{ statement_timeout: string }[]>(`show statement_timeout`))[0]!
          .statement_timeout,
    );

    // One budget for both queries: whole milliseconds, at most 2 s, set after the first query.
    // (PostgreSQL shows a whole number of seconds as "2s", others as "1873ms".)
    const insideMs = Number.parseInt(inside, 10) * (inside.endsWith("ms") ? 1 : 1000);

    expect(insideMs).toBeGreaterThan(0);
    expect(insideMs).toBeLessThanOrEqual(2000);
    expect(after).not.toBe(inside);
  });

  it("answers with a message, not an error, when the time limit cancels the query", async () => {
    const slow: CatalogDeps = {
      ...deps,
      repository: {
        ...postgresCatalogRepository,
        searchPublicCatalog: async (tx) => {
          await tx.em.execute(`set local statement_timeout = '30ms'`);
          await tx.em.execute(`select pg_sleep(1)`);

          throw new Error("not reached");
        },
      },
    };

    expect(await searchPublicCatalog("wieza", undefined, slow)).toEqual({ status: "timeout" });
    // The connection is usable afterwards.
    expect((await search("wieza")).status).toBe("ok");
  });
});
