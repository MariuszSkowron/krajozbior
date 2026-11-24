import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NearbyCandidate } from "@/features/catalog/domain/nearby";

const mocks = vi.hoisted(() => ({ list: vi.fn(), log: vi.fn() }));

vi.mock("@/features/catalog/application/public-catalog", () => ({
  listNearbyCandidates: mocks.list,
}));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({ getCatalogDeps: () => ({}) }));
vi.mock("@/app/request-actor", () => ({ logReadFailure: mocks.log }));

const { GET } = await import("@/app/api/nearby/route");

// What the server may send for "Pokaż najbliższe": at most 200 collections with up to 500 places
// each (D-25), rounded to 3 decimals. The size is bounded here so a change that adds fields or
// precision shows up as a failing test. The answer is fetched only after the click.
const MAX_BYTES = 2_500_000;

const candidates = (collections: number, places: number): NearbyCandidate[] =>
  Array.from({ length: collections }, (_, index) => ({
    slug: `kolekcja-${index}-z-dlugim-adresem-strony`,
    title: `Kolekcja numer ${index} z dość długim tytułem`,
    region: "pomorskie",
    placeCount: places,
    points: Array.from({ length: places }, (_, place): [number, number] => [
      54.123 + place / 1000,
      18.456 + place / 1000,
    ]),
    firstPublishedAt: "2026-11-01T10:00:00.000Z",
  }));

describe("GET /api/nearby", () => {
  // The list is kept in the memory of the server for five minutes; every test starts past that.
  let clock = Date.parse("2026-11-24T10:00:00Z");

  beforeEach(() => {
    mocks.list.mockReset();
    mocks.log.mockReset();
    clock += 20 * 60 * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the database once for repeated requests inside the five minutes", async () => {
    mocks.list.mockResolvedValue(candidates(1, 2));

    await GET();
    await GET();

    expect(mocks.list).toHaveBeenCalledTimes(1);

    vi.setSystemTime(clock + 5 * 60 * 1000 + 1);
    await GET();

    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("returns the public list for anyone, cacheable, with no request parameter read", async () => {
    mocks.list.mockResolvedValue(candidates(2, 3));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");

    const body = (await response.json()) as { candidates: NearbyCandidate[] };

    expect(body.candidates).toHaveLength(2);
    expect(Object.keys(body)).toEqual(["candidates"]);
    expect(Object.keys(body.candidates[0]!).sort()).toEqual([
      "firstPublishedAt",
      "placeCount",
      "points",
      "region",
      "slug",
      "title",
    ]);
  });

  it("keeps the answer small for the largest list the server allows (200 x 500 places)", async () => {
    mocks.list.mockResolvedValue(candidates(200, 500));

    const text = await (await GET()).text();

    expect(text.length).toBeLessThan(MAX_BYTES);
  });

  it("answers 503 without details and logs only the class when the read fails", async () => {
    mocks.list.mockRejectedValue(new Error("db down: secret-host"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(mocks.log).toHaveBeenCalledWith("Nearby API read", expect.any(Error));
  });
});
