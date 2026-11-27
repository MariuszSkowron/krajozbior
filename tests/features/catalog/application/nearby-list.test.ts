import { describe, expect, it, vi } from "vitest";

import {
  createNearbyList,
  dedupeNearbyPoints,
  NEARBY_LIST_TTL_MS,
} from "@/features/catalog/application/nearby-list";
import type { NearbyCandidate } from "@/features/catalog/domain/nearby";

const candidate = (points: [number, number][]): NearbyCandidate => ({
  slug: "zamki",
  title: "Zamki",
  region: "pomorskie",
  placeCount: points.length,
  points,
  firstPublishedAt: null,
});

describe("createNearbyList", () => {
  it("does not read again inside the window, and reads again after five minutes", async () => {
    let now = 1000;
    const read = vi.fn(async () => [candidate([[54, 18]])]);
    const list = createNearbyList({ read, now: () => now });

    await list();
    now += NEARBY_LIST_TTL_MS - 1;
    await list();

    expect(read).toHaveBeenCalledTimes(1);

    now += 1;
    await list();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("gives parallel calls on an empty cache a single read", async () => {
    let release: (value: readonly NearbyCandidate[]) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<readonly NearbyCandidate[]>((resolve) => {
          release = resolve;
        }),
    );
    const list = createNearbyList({ read, now: () => 0 });
    const all = Promise.all([list(), list(), list()]);

    release([candidate([[54, 18]])]);

    const results = await all;

    expect(read).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[2]);
  });

  it("does not keep a failed read: the next call tries again", async () => {
    const read = vi
      .fn<() => Promise<readonly NearbyCandidate[]>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce([candidate([[54, 18]])]);
    const list = createNearbyList({ read, now: () => 0 });

    await expect(list()).rejects.toThrow("db down");
    await expect(list()).resolves.toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("drops repeated points of a collection and leaves a clean one as it is", async () => {
    const clean = candidate([[54, 18]]);
    const repeated = candidate([
      [54.1, 18.1],
      [54.1, 18.1],
      [54.2, 18.2],
    ]);

    const [first, second] = dedupeNearbyPoints([clean, repeated]);

    expect(first).toBe(clean);
    expect(second?.points).toEqual([
      [54.1, 18.1],
      [54.2, 18.2],
    ]);
    expect(second?.placeCount).toBe(3);
  });
});
