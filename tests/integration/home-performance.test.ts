import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HOME_FAVORITES_LIMIT, HOME_RECENT_VISITS_LIMIT } from "@/features/album/domain/home-album";
import { postgresAlbumRepository } from "@/features/album/infrastructure/postgres-album-repository";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// E12-1, review note m2: time of the queries of the home page on synthetic data (200 collections,
// 5 000 places, one explorer with 1 000 visits and 40 saved collections) as krajozbior_app with
// RLS on. The test only checks a generous limit; the medians go to the file named by
// HOME_PERF_OUT, when set (the run notes keep them).
let db: ScratchDatabase;
let app: MikroORM;

const COLLECTIONS = 200;
const PLACES = 5000;
const VISITS = 1000;
const SAVED = 40;
const RUNS = 15;
const user = { id: randomUUID() };

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

describe("home page queries on synthetic data (explorer, RLS on)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_home_perf");
    await db.migrate();

    await withClient(db.adminUrl, async (client) => {
      await client.query(
        `insert into auth.users (id, name, email) values ($1, 'perf', 'perf@example.com')`,
        [user.id],
      );

      const org = (
        await client.query(
          `insert into public.organizations (name, slug, kind)
           values ('Gmina Perf', 'gmina-perf', 'municipality') returning id`,
        )
      ).rows[0] as { id: string };

      await client.query(
        `insert into public.collections (slug, organization_id, title, region, status)
         select 'perf-' || n, $1, 'Kolekcja ' || n,
                (array['pomorskie','lodzkie','slaskie','opolskie'])[1 + n % 4], 'published'
           from generate_series(1, $2) n`,
        [org.id, COLLECTIONS],
      );
      await client.query(
        `insert into public.places (organization_id, name, address, latitude, longitude)
         select $1, 'Miejsce ' || n, 'ul. Przykładowa ' || n, 54, 18
           from generate_series(1, $2) n`,
        [org.id, PLACES],
      );
      await client.query(
        `insert into public.collection_places (collection_id, place_id, organization_id, position)
         select c.id, p.id, $1, row_number() over (partition by c.id order by p.name)
           from (select id, row_number() over (order by slug) - 1 as rn from public.collections) c
           join (select id, name, row_number() over (order by name) - 1 as rn from public.places) p
             on p.rn % $2 = c.rn`,
        [org.id, COLLECTIONS],
      );
      await client.query(
        `insert into public.visits (user_id, place_id, kind, date_precision, visited_at)
         select $1, p.id, 'past', 'unknown', now() - (p.rn || ' minutes')::interval
           from (select id, row_number() over (order by name) as rn from public.places limit $2) p`,
        [user.id, VISITS],
      );
      await client.query(
        `insert into public.saved_collections (user_id, collection_id)
         select $1, id from public.collections order by slug limit $2`,
        [user.id, SAVED],
      );

      // Statistics as autovacuum would have gathered them; without them the planner assumes
      // one row everywhere and the plan is not the one a running database uses.
      if (process.env.HOME_PERF_NO_ANALYZE === undefined) {
        await client.query("analyze");
      }
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

  it("answers every home query well inside a second", async () => {
    const queries: Record<
      string,
      (tx: Parameters<typeof postgresAlbumRepository.homeSummary>[0]) => Promise<unknown>
    > = {
      homeSummary: (tx) => postgresAlbumRepository.homeSummary(tx),
      homeFavorites: (tx) => postgresAlbumRepository.homeFavorites(tx, HOME_FAVORITES_LIMIT),
      homeRecentVisits: (tx) =>
        postgresAlbumRepository.homeRecentVisits(tx, HOME_RECENT_VISITS_LIMIT),
      listRecentlyPublishedCollections: (tx) =>
        postgresCatalogRepository.listRecentlyPublishedCollections(tx, 6),
    };
    const lines: string[] = [
      `Synthetic data: ${COLLECTIONS} collections, ${PLACES} places, ${VISITS} visits, ${SAVED} saved collections; role krajozbior_app (RLS on), ${RUNS} runs each (after 1 warm-up).`,
    ];

    for (const [name, query] of Object.entries(queries)) {
      await runInUserContext(app.em, user, (tx) => query(tx));
      const times: number[] = [];

      for (let run = 0; run < RUNS; run += 1) {
        const started = performance.now();

        await runInUserContext(app.em, user, (tx) => query(tx));
        times.push(performance.now() - started);
      }

      lines.push(
        `${name} (with transaction + context): median ${median(times).toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`,
      );
      expect(median(times), name).toBeLessThan(1000);
    }

    const total: number[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();

      await runInUserContext(app.em, user, async (tx) => {
        await postgresAlbumRepository.homeSummary(tx);
        await postgresAlbumRepository.homeFavorites(tx, HOME_FAVORITES_LIMIT);
        await postgresAlbumRepository.homeRecentVisits(tx, HOME_RECENT_VISITS_LIMIT);
      });
      total.push(performance.now() - started);
    }
    lines.push(
      `all three personal queries in ONE transaction: median ${median(total).toFixed(1)} ms, max ${Math.max(...total).toFixed(1)} ms`,
    );

    const published = `c.status = 'published' and o.status = 'approved'`;
    const plans: Record<string, string> = {
      homeRecentVisits: `select l.id, p.name
         from (select id, place_id, visited_at from public.visits
                where user_id = app_current_user_id()
                order by visited_at desc, id desc limit 5) l
         left join public.places p on p.id = l.place_id and exists (
           select from public.collection_places pcp
             join public.collections c on c.id = pcp.collection_id
             join public.organizations o on o.id = c.organization_id
            where pcp.place_id = p.id and ${published}
         ) and exists (select from public.organizations po where po.id = p.organization_id and po.status = 'approved')
        order by l.visited_at desc, l.id desc`,
      homeSummary: `select
         (select count(distinct v.place_id)::int from public.visits v
           where v.user_id = app_current_user_id()) as a,
         (select count(distinct c.region)::int from public.visits v
            join public.collection_places cp on cp.place_id = v.place_id
            join public.collections c on c.id = cp.collection_id
            join public.organizations o on o.id = c.organization_id
           where v.user_id = app_current_user_id() and ${published}) as b`,
    };

    for (const [name, sql] of Object.entries(plans)) {
      const plan = await runInUserContext(app.em, user, async (tx) => {
        const rows = await tx.em.execute<Record<string, string>[]>(
          `explain (analyze, buffers) ${sql}`,
        );

        return rows.map((row) => row["QUERY PLAN"]).join("\n");
      });

      lines.push("", `EXPLAIN (ANALYZE, BUFFERS) ${name}:`, plan);
    }

    if (process.env.HOME_PERF_OUT !== undefined) {
      writeFileSync(process.env.HOME_PERF_OUT, `${lines.join("\n")}\n`, "utf8");
    }
    expect(median(total)).toBeLessThan(1000);
  }, 120_000);
});
