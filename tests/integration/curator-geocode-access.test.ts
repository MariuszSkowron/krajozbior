import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";

import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// Wyszukiwanie adresu w edytorze miejsca (K-2) przez prawdziwy moduł trasy: sesja, baza i
// usługa geokodowania pochodzą z testu (żadnego prawdziwego zapytania do Nominatim).
const state = vi.hoisted(() => ({
  session: null as { id: string; role: "user" | "admin" } | null,
  allow: true,
  app: null as unknown as import("@mikro-orm/postgresql").MikroORM,
  geocode: vi.fn(),
}));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: async () => state.session }),
  getActionRateLimiter: () => ({ reserve: async () => ({ allowed: true }) }),
}));
vi.mock("@/features/catalog/infrastructure/nominatim-geocoder", () => ({
  getGeocoder: () => state.geocode,
}));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({
  getCatalogDeps: () => ({
    withUserContext: (actor: { id: string }, work: never) =>
      runInUserContext(state.app.em, actor, work),
    withGuestContext: (work: never) => runInGuestContext(state.app.em, work),
    limiter: {
      reserve: async () =>
        state.allow ? { allowed: true } : { allowed: false, retryAfterSeconds: 7 },
    },
    repository: postgresCatalogRepository,
    random: (max: number) => randomInt(max),
  }),
}));

let db: ScratchDatabase;
let app: MikroORM;
let route: typeof import("@/app/api/curator/geocode/route");

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curator = user("geo-cur");
const explorer = user("geo-explorer");
const admin = user("geo-admin");
const found = [{ label: "Rumia, Pomorskie", latitude: 54.0928, longitude: 18.7919 }];

const post = (body: unknown, headers: Record<string, string> = {}) =>
  route.POST(
    new Request("http://localhost/api/curator/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/curator/geocode", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_curator_geocode");
    await db.migrate();

    const admin$ = <T>(sql: string, params: unknown[] = []) =>
      withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

    for (const { id, email } of [curator, explorer, admin]) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }

    const [{ id: organizationId }] = await admin$<{ id: string }>(
      `insert into public.organizations (name, slug, kind) values ('Gmina G', 'geo-gmina', 'municipality') returning id`,
    );

    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [organizationId, curator.id],
    );

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
    state.app = app;
    route = await import("@/app/api/curator/geocode/route");
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  beforeEach(() => {
    state.session = { id: curator.id, role: "user" };
    state.allow = true;
    state.geocode.mockReset();
    state.geocode.mockResolvedValue(found);
  });

  it("gives a curator the places found, and sends only the typed text to the service", async () => {
    const response = await post({ query: "ul. Dworcowa 1, Rumia", userId: "other" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ results: found });
    expect(state.geocode).toHaveBeenCalledTimes(1);
    expect(state.geocode).toHaveBeenCalledWith("ul. Dworcowa 1, Rumia");
  });

  it("answers with an empty list when nothing is found", async () => {
    state.geocode.mockResolvedValue([]);

    const response = await post({ query: "qqqqqq" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [] });
  });

  it("refuses a guest with 401, an explorer and an administrator with 403, asking nobody", async () => {
    state.session = null;
    expect((await post({ query: "Rumia" })).status).toBe(401);

    state.session = { id: explorer.id, role: "user" };
    expect((await post({ query: "Rumia" })).status).toBe(403);

    // Roles do not inherit: an administrator without a membership is no curator.
    state.session = { id: admin.id, role: "admin" };
    expect((await post({ query: "Rumia" })).status).toBe(403);

    expect(state.geocode).not.toHaveBeenCalled();
  });

  it("refuses a request from another origin before anything else", async () => {
    const response = await post({ query: "Rumia" }, { Origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(state.geocode).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After past the limit and does not ask the service", async () => {
    state.allow = false;

    const response = await post({ query: "Rumia" });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    expect(state.geocode).not.toHaveBeenCalled();
  });

  it("answers 400 for a query that is too short or missing", async () => {
    expect((await post({ query: "ab" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(state.geocode).not.toHaveBeenCalled();
  });

  it("answers 503 without details when the service fails", async () => {
    state.geocode.mockRejectedValue(new Error("Geocoder answered 500: secret details"));

    const response = await post({ query: "Rumia" });

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/secret/);
  });
});
