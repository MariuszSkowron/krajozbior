import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addToWantToSee,
  isWantedPlace,
  listWantToSee,
  removeFromWantToSee,
} from "@/features/want-to-see/application/want-to-see";
import type { WantToSeeDeps } from "@/features/want-to-see/application/want-to-see-types";
import { postgresWantToSeeRepository } from "@/features/want-to-see/infrastructure/postgres-want-to-see-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// E2-S5, PR8: the use cases of the "Chcę zobaczyć" list on the real database,
// as krajozbior_app (max 1 connection, so a leaked context would show). The
// table, its policies and the raw-SQL refusals are covered by album-access;
// here the use cases prove the same promises: explorer B neither sees nor
// changes the list of A, a guest is refused, a draft place is unavailable.
let db: ScratchDatabase;
let app: MikroORM;

const explorerA = { ...newUser("want-explorer-a"), role: "user" as const };
const explorerB = { ...newUser("want-explorer-b"), role: "user" as const };
const curA = newUser("want-cur-a");

let orgA = "";

const f = albumFixtures({ db: () => db, app: () => app });

const deps = (allowed = true): WantToSeeDeps => ({
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  limiter: {
    reserve: async () => (allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 30 }),
  },
  repository: postgresWantToSeeRepository,
});

describe("the want-to-see use cases", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_want_to_see");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, curA]);
    orgA = await f.newOrganization("Gmina A", "gmina-a", [curA]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("adds, lists with the date and removes, idempotently", async () => {
    const { placeIds } = await f.publishedCollection(curA, orgA);
    const placeId = placeIds[0]!;

    expect(await addToWantToSee(explorerA, placeId, deps())).toEqual({
      status: "ok",
      value: { wanted: true },
    });
    expect(await addToWantToSee(explorerA, placeId, deps())).toEqual({
      status: "ok",
      value: { wanted: true },
    });
    expect(await isWantedPlace(explorerA, placeId, deps())).toEqual({
      status: "ok",
      value: { wanted: true },
    });

    const listed = await listWantToSee(explorerA, deps());

    expect(listed.status).toBe("ok");

    if (listed.status === "ok") {
      const mine = listed.value.filter((place) => place.id === placeId);

      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ name: "Miejsce" });
      expect(mine[0]!.savedAt).toBeInstanceOf(Date);
      expect(Math.abs(mine[0]!.savedAt.getTime() - Date.now())).toBeLessThan(60_000);
      expect(Object.keys(mine[0]!).sort()).toEqual(["address", "id", "name", "savedAt"]);
    }

    for (let i = 0; i < 2; i += 1) {
      expect(await removeFromWantToSee(explorerA, placeId, deps())).toEqual({
        status: "ok",
        value: { wanted: false },
      });
    }
    expect(await isWantedPlace(explorerA, placeId, deps())).toEqual({
      status: "ok",
      value: { wanted: false },
    });
  });

  it("keeps the list of A from explorer B: not listed, not removable, not wanted", async () => {
    const { placeIds } = await f.publishedCollection(curA, orgA);
    const placeId = placeIds[0]!;

    await addToWantToSee(explorerA, placeId, deps());

    const asB = await listWantToSee(explorerB, deps());

    expect(asB).toEqual({ status: "ok", value: [] });
    expect(await isWantedPlace(explorerB, placeId, deps())).toEqual({
      status: "ok",
      value: { wanted: false },
    });
    // B "removes" it: the same answer as for any place, and nothing changes for A.
    expect(await removeFromWantToSee(explorerB, placeId, deps())).toEqual({
      status: "ok",
      value: { wanted: false },
    });
    expect(await isWantedPlace(explorerA, placeId, deps())).toEqual({
      status: "ok",
      value: { wanted: true },
    });
    // B adding the same place gets an entry of their own, not the one of A.
    await addToWantToSee(explorerB, placeId, deps());
    await removeFromWantToSee(explorerA, placeId, deps());
    expect(await isWantedPlace(explorerB, placeId, deps())).toEqual({
      status: "ok",
      value: { wanted: true },
    });
    await removeFromWantToSee(explorerB, placeId, deps());
  });

  it("refuses a guest on every use case, before the database", async () => {
    const { placeIds } = await f.publishedCollection(curA, orgA);
    const refused = { status: "unauthenticated" };

    expect(await addToWantToSee(null, placeIds[0]!, deps())).toEqual(refused);
    expect(await removeFromWantToSee(null, placeIds[0]!, deps())).toEqual(refused);
    expect(await listWantToSee(null, deps())).toEqual(refused);
    expect(await isWantedPlace(null, placeIds[0]!, deps())).toEqual(refused);
    expect(
      await f.admin$(`select 1 from public.want_to_see_places where place_id = $1`, [placeIds[0]]),
    ).toEqual([]);
  });

  it("gives not_found for a place of a draft, a missing place and a malformed id, also to a curator of the draft", async () => {
    const { placeIds } = await f.draftCollection(curA, orgA);
    const notFound = { status: "not_found" };

    expect(await addToWantToSee(explorerA, placeIds[0]!, deps())).toEqual(notFound);
    expect(await addToWantToSee({ ...curA, role: "user" }, placeIds[0]!, deps())).toEqual(notFound);
    expect(await addToWantToSee(explorerA, "00000000-0000-4000-8000-000000000000", deps())).toEqual(
      notFound,
    );
    expect(await addToWantToSee(explorerA, "not-a-uuid", deps())).toEqual(notFound);
    expect(
      await f.admin$(`select 1 from public.want_to_see_places where place_id = $1`, [placeIds[0]]),
    ).toEqual([]);
  });

  it("hides a place from the list while its collection is withdrawn, and shows it again after publishing", async () => {
    const { collectionId, placeIds } = await f.publishedCollection(curA, orgA);
    const placeId = placeIds[0]!;

    await addToWantToSee(explorerA, placeId, deps());
    await f.setStatus(curA, collectionId, "draft");

    const hidden = await listWantToSee(explorerA, deps());

    expect(hidden.status === "ok" && hidden.value.some((p) => p.id === placeId)).toBe(false);
    // The entry itself survives (D-15 spirit: the withdrawal does not erase what explorers saved).
    expect(
      await f.admin$(`select 1 from public.want_to_see_places where place_id = $1`, [placeId]),
    ).toHaveLength(1);

    await f.setStatus(curA, collectionId, "published");

    const back = await listWantToSee(explorerA, deps());

    expect(back.status === "ok" && back.value.some((p) => p.id === placeId)).toBe(true);
    await removeFromWantToSee(explorerA, placeId, deps());
  });

  it("answers rate_limited without writing", async () => {
    const { placeIds } = await f.publishedCollection(curA, orgA);

    expect(await addToWantToSee(explorerA, placeIds[0]!, deps(false))).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 30,
    });
    expect(
      await f.admin$(`select 1 from public.want_to_see_places where place_id = $1`, [placeIds[0]]),
    ).toEqual([]);
  });
});
