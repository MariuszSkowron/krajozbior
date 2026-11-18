import { randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { postgresAlbumRepository } from "@/features/album/infrastructure/postgres-album-repository";
import { saveCollection } from "@/features/album/application/saved-collections";
import { hasVisitedPlace } from "@/features/visits/application/confirm-on-site-visit";
import type { VisitDeps } from "@/features/visits/application/visit-types";
import { postgresVisitRepository } from "@/features/visits/infrastructure/postgres-visit-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// E2-S2, PR7: POST /api/places/[placeId]/visits through the real route, the
// real use case and the real database function (docs/data-isolation.md, class
// PRIV). Only the session and the limiter come from the test. The distance
// rule itself is tested in visits-access.test.ts; here: who may call the route
// and what it answers.
const state = vi.hoisted(() => ({
  session: null as { id: string; role: "user" | "admin" } | null,
  allow: true,
  app: null as unknown as import("@mikro-orm/postgresql").MikroORM,
}));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: async () => state.session }),
  getActionRateLimiter: () => ({
    reserve: async () =>
      state.allow ? { allowed: true } : { allowed: false, retryAfterSeconds: 7 },
  }),
}));
vi.mock("@/features/visits/infrastructure/visit-deps", () => ({
  getVisitDeps: () => deps(),
}));

let db: ScratchDatabase;
let app: MikroORM;

const explorerA = newUser("vr-explorer-a");
const explorerB = newUser("vr-explorer-b");
const cur = newUser("vr-cur");
const a = { ...explorerA, role: "user" as const };
const b = { ...explorerB, role: "user" as const };
const curActor = { ...cur, role: "user" as const };

const f = albumFixtures({ db: () => db, app: () => app });
const deps = (): VisitDeps => ({
  withUserContext: (actor, work) => runInUserContext(state.app.em, actor, work),
  limiter: {
    reserve: async () =>
      state.allow ? { allowed: true } : { allowed: false, retryAfterSeconds: 7 },
  },
  repository: postgresVisitRepository,
  album: postgresAlbumRepository,
});

const EARTH_RADIUS_M = 6_371_008.8;
const LAT = 54.0;
const LON = 18.0;
const north = (metres: number) => LAT + ((metres / EARTH_RADIUS_M) * 180) / Math.PI;

let route: typeof import("@/app/api/places/[placeId]/visits/route");
let collectionId = "";
let organizationId = "";
let place = "";
let draftPlace = "";

const visitCount = async (userId: string, placeId: string) =>
  Number(
    (
      await f.admin$<{ n: string }>(
        `select count(*) as n from public.visits where user_id = $1 and place_id = $2`,
        [userId, placeId],
      )
    )[0]!.n,
  );

const reading = (over: Record<string, unknown> = {}) => ({
  latitude: LAT,
  longitude: LON,
  accuracy: 10,
  clientVisitId: randomUUID(),
  ...over,
});

const post = (placeId: string, body: unknown, headers: Record<string, string> = {}) =>
  route.POST(
    new Request(`http://localhost/api/places/${placeId}/visits`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ placeId }) },
  );

describe("POST /api/places/[placeId]/visits", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_visit_route");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, cur]);

    const orgId = await f.newOrganization("Gmina Wizyt", "gmina-wizyt", [cur]);

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
    state.app = app;
    route = await import("@/app/api/places/[placeId]/visits/route");

    organizationId = orgId;

    const published = await f.publishedCollection(curActor, orgId, 2);

    collectionId = published.collectionId;
    place = published.placeIds[0]!;
    draftPlace = (await f.draftCollection(curActor, orgId)).placeIds[0]!;
    await saveCollection(a, collectionId, {
      withUserContext: deps().withUserContext,
      limiter: deps().limiter,
      repository: postgresAlbumRepository,
    });
  }, 60_000);

  beforeEach(() => {
    state.session = null;
    state.allow = true;
  });

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("denies a guest with 401 and records nothing", async () => {
    const response = await post(place, reading());

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await visitCount(explorerA.id, place)).toBe(0);
  });

  it("denies a foreign origin with 403 before anything else", async () => {
    state.session = a;

    expect((await post(place, reading(), { origin: "http://evil.example" })).status).toBe(403);
    expect(await visitCount(explorerA.id, place)).toBe(0);
  });

  it("records a visit in range, answers with the progress and no position, and keeps the visit private", async () => {
    state.session = a;

    const response = await post(place, reading({ latitude: north(150) }));
    const text = await response.text();

    expect(response.status).toBe(201);
    expect(JSON.parse(text)).toEqual({
      result: "recorded",
      collections: [
        expect.objectContaining({ progress: { kind: "progress", visited: 1, total: 2 } }),
      ],
    });
    // Neither the position nor the accuracy of the reading comes back.
    expect(text).not.toContain(String(north(150)));
    expect(text).not.toContain("accuracy");
    expect(await visitCount(explorerA.id, place)).toBe(1);

    // Explorer B sees nothing of it, on the use case and in the database.
    const seenByA = await hasVisitedPlace(a, place, deps());
    const seenByB = await hasVisitedPlace(b, place, deps());

    expect(seenByA).toEqual({ status: "ok", value: { visited: true } });
    expect(seenByB).toEqual({ status: "ok", value: { visited: false } });
    expect(await visitCount(explorerB.id, place)).toBe(0);
  });

  it("records one visit when the same attempt is sent twice (a retry after a lost answer)", async () => {
    state.session = b;

    const body = reading();

    expect((await post(place, body)).status).toBe(201);
    expect((await post(place, body)).status).toBe(201);
    expect(await visitCount(explorerB.id, place)).toBe(1);
  });

  it("tells the distance when the person is too far, and the accuracy when it is too poor", async () => {
    state.session = b;

    const far = await post(place, reading({ latitude: north(6200) }));
    const poor = await post(place, reading({ accuracy: 480.6 }));

    expect(far.status).toBe(200);
    expect(await far.json()).toEqual({ result: "out_of_range", distanceM: 6200 });
    expect(poor.status).toBe(200);
    expect(await poor.json()).toEqual({ result: "inaccurate", accuracyM: 481 });
  });

  it("answers inaccurate, not 400, for a reading worse than 100 km, and shows the real value", async () => {
    state.session = b;

    const response = await post(place, reading({ accuracy: 150_000 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "inaccurate", accuracyM: 150_000 });
  });

  it("answers a retry as recorded when the place was unpublished after the first answer was lost, and never shows another user's visit", async () => {
    const made = await f.publishedCollection(curActor, organizationId, 1);
    const target = made.placeIds[0]!;
    const body = reading();

    state.session = a;
    expect((await post(target, body)).status).toBe(201);
    expect(await visitCount(explorerA.id, target)).toBe(1);

    await f.setStatus(curActor, made.collectionId, "draft");
    try {
      // Without the check the function would answer not_found (404).
      expect((await post(target, body)).status).toBe(201);
      expect(await visitCount(explorerA.id, target)).toBe(1);

      // The same client visit id of another user: the unpublished place stays
      // invisible, and nothing of the visit of A is shown or created.
      state.session = b;
      expect((await post(target, body)).status).toBe(404);
      expect(await visitCount(explorerB.id, target)).toBe(0);
    } finally {
      await f.setStatus(curActor, made.collectionId, "published");
    }

    // After publishing again B records an own visit with the same id (the id is per user).
    expect((await post(target, body)).status).toBe(201);
    expect(await visitCount(explorerB.id, target)).toBe(1);
    expect(await visitCount(explorerA.id, target)).toBe(1);
  });

  it("answers 404 for a place that is only in a draft, for an explorer and for the curator of the organization", async () => {
    for (const session of [a, curActor]) {
      state.session = session;

      expect((await post(draftPlace, reading())).status).toBe(404);
      expect(await visitCount(session.id, draftPlace)).toBe(0);
    }
  });

  it("answers 404 for an unknown place and a malformed id", async () => {
    state.session = a;

    expect((await post(randomUUID(), reading())).status).toBe(404);
    expect((await post("nope", reading())).status).toBe(404);
  });

  it("answers 400 for a body of the wrong shape and 413 for a huge one", async () => {
    state.session = a;

    expect((await post(place, reading({ latitude: 91 }))).status).toBe(400);
    expect((await post(place, "not json")).status).toBe(400);
    expect((await post(place, { ...reading(), padding: "x".repeat(20_000) })).status).toBe(413);
  });

  it("answers a guest 401 even for a broken body", async () => {
    expect((await post(place, "not json")).status).toBe(401);
  });

  it("answers 429 over the limit and records nothing", async () => {
    state.session = a;
    state.allow = false;

    const before = await visitCount(explorerA.id, place);
    const response = await post(place, reading());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(await visitCount(explorerA.id, place)).toBe(before);
  });

  it("refuses a raw insert of an on-site visit by the app role (the database is the second barrier)", async () => {
    await expect(
      f.as(
        a,
        `insert into public.visits (user_id, place_id, kind, client_visit_id)
         values (app_current_user_id(), ?, 'on_site', ?)`,
        [place, randomUUID()],
      ),
    ).rejects.toThrow(/row-level security|permission denied/);
  });
});
