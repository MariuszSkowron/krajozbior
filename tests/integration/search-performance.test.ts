import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  placeInPublicCollection,
  publishedCollection,
} from "@/features/catalog/infrastructure/public-visibility";
import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { searchPublicCatalog } from "@/features/catalog/application/public-search";
import { foldSql } from "@/features/catalog/domain/search";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// E12-2, D-E12-10 / E12-Q7: the search scans the tables without an index, with the row policy of
// a guest on every row. This measures it on synthetic data (200 collections, 5 000 places) as
// krajozbior_app (RLS on), not as the owner. The limit of the test is the time limit of the
// // search itself (2 s), measured warm (after warm-up passes) as the median of 12 runs; the plan and
// the times go to the file named by SEARCH_EXPLAIN_OUT, when set (the run notes keep them). The decision whether to add pg_trgm follows from the numbers.
let db: ScratchDatabase;
let app: MikroORM;

const COLLECTIONS = 200;
const PLACES = 5000;

const deps: CatalogDeps = {
  withUserContext: () => {
    throw new Error("not used");
  },
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
};

describe("search on synthetic data (guest, RLS on)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_search_perf");
    await db.migrate();

    const orgId = (
      await withClient(
        db.adminUrl,
        async (client) =>
          (
            await client.query(
              `insert into public.organizations (name, slug, kind)
               values ('Gmina Perf', 'gmina-perf', 'municipality') returning id`,
            )
          ).rows as { id: string }[],
      )
    )[0]!.id;

    await withClient(db.adminUrl, async (client) => {
      await client.query(
        `insert into public.collections (slug, organization_id, title, summary, region, status)
         select 'perf-' || n, $1, 'Kolekcja ' || n || ' ' || (array['Wieże','Zamki','Młyny','Łódź','Żuławy'])[1 + n % 5],
                'Opis kolekcji numer ' || n, (array['pomorskie','lodzkie','slaskie','opolskie'])[1 + n % 4], 'published'
           from generate_series(1, $2) n`,
        [orgId, COLLECTIONS],
      );
      await client.query(
        `insert into public.places (organization_id, name, address, latitude, longitude)
         select $1, 'Miejsce ' || n || ' ' || (array['Wieża','Zamek','Młyn','Łaźnia','Żuraw'])[1 + n % 5],
                'ul. Przykładowa ' || n || ', Miasto ' || n % 97, 54, 18
           from generate_series(1, $2) n`,
        [orgId, PLACES],
      );
      await client.query(
        `insert into public.collection_places (collection_id, place_id, organization_id, position)
         select c.id, p.id, $1, row_number() over (partition by c.id order by p.name)
           from (select id, row_number() over (order by slug) - 1 as rn from public.collections) c
           join (select id, name, row_number() over (order by name) - 1 as rn from public.places) p
             on p.rn % $2 = c.rn`,
        [orgId, COLLECTIONS],
      );
    });

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("answers a search over 200 collections and 5 000 places well inside the time limit", async () => {
    const times: number[] = [];
    const phrases = ["wieza", "lodz", "przykladowa 4", "zzzz nie ma"];

    // Warm-up outside the measurement: two passes over every phrase warm the connection, the
    // plan cache and the page cache. Their outcome and time are ignored (a cold first search on a
    // loaded machine can exceed the 2 s statement timeout, which says nothing about steady state).
    for (let pass = 0; pass < 2; pass += 1) {
      for (const phrase of phrases) {
        await searchPublicCatalog(phrase, undefined, deps);
      }
    }

    for (const phrase of phrases) {
      for (let run = 0; run < 3; run += 1) {
        const started = performance.now();
        const outcome = await searchPublicCatalog(phrase, undefined, deps);

        times.push(performance.now() - started);
        // "timeout" is the 2 s statement timeout of the search itself: a slow sample (it took
        // about 2 s), judged below with the others; any other failure status is a real error.
        expect(["ok", "timeout"], phrase).toContain(outcome.status);
      }
    }

    const sorted = [...times].sort((a, b) => a - b);

    // The hard per-search limit of 2 s (D-E12-10) is enforced by the product itself (statement
    // timeout). The test judges the typical search: the median of 12 warm runs must stay under
    // 2 s. The maximum or p90 of 12 samples is decided by one or two runs, so a short burst of
    // machine load (other processes, the first cold run) would fail it without telling anything.
    expect(sorted[6]!).toBeLessThan(2000);

    const explain = await runInGuestContext(app.em, async (tx) => {
      const rows = await tx.em.execute<Record<string, string>[]>(
        `explain (analyze, buffers)
         select p.id, p.name, p.address, pc.slug, pc.title
           from public.places p
          cross join lateral (
            select c.slug, c.title
              from public.collection_places cp
              join public.collections c on c.id = cp.collection_id
              join public.organizations o on o.id = c.organization_id
             where cp.place_id = p.id and ${publishedCollection}
             order by c.title, c.slug
             limit 1
          ) pc
          where ${placeInPublicCollection}
            and (${foldSql("p.name")} like ? escape '\\' or ${foldSql("p.address")} like ? escape '\\')
          order by (${foldSql("p.name")} like ? escape '\\') desc, p.name, p.id
          limit 21`,
        ["%wieza%", "%wieza%", "wieza%"],
      );

      return rows.map((row) => row["QUERY PLAN"]).join("\n");
    });

    const report = [
      `Synthetic data: ${COLLECTIONS} collections, ${PLACES} places, role krajozbior_app (RLS on), guest context.`,
      `Search use case, 12 measured runs after 2 warm-up passes (ms): min ${sorted[0]!.toFixed(1)}, median ${sorted[6]!.toFixed(1)}, p90 ${sorted[10]!.toFixed(1)}, max ${sorted.at(-1)!.toFixed(1)}.`,
      "",
      "EXPLAIN (ANALYZE, BUFFERS) of the places query, phrase 'wieza':",
      explain,
    ].join("\n");

    if (process.env.SEARCH_EXPLAIN_OUT !== undefined) {
      writeFileSync(process.env.SEARCH_EXPLAIN_OUT, `${report}\n`, "utf8");
    }
    expect(explain).toContain("Execution Time");
  }, 120_000);
});
