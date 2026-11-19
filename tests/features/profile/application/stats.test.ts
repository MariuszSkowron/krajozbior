import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/features/identity/domain/actor";
import { getMyStats } from "@/features/profile/application/stats";
import type { ProfileStatsDeps, VisitStatsData } from "@/features/profile/application/stats-types";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };

function makeDeps(data: VisitStatsData) {
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
    work({} as never),
  );
  const readVisitStats = vi.fn(async () => data);

  return {
    deps: { withUserContext, repository: { readVisitStats } } as unknown as ProfileStatsDeps,
    withUserContext,
    readVisitStats,
  };
}

describe("getMyStats", () => {
  it("counts places, distinct regions of the list and the kilometres, in the user context of the actor", async () => {
    const { deps, withUserContext, readVisitStats } = makeDeps({
      visitedPlaces: 3,
      regions: ["pomorskie", "pomorskie", "slaskie", "polska", "nieznane"],
      visits: [
        { kind: "on_site", visitedAt: "2026-07-10T08:00:00Z", latitude: 0, longitude: 0 },
        { kind: "on_site", visitedAt: "2026-07-10T09:00:00Z", latitude: 0, longitude: 1 },
      ],
    });

    const result = await getMyStats(actor, deps);

    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
    expect(readVisitStats).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "ok",
      value: { visitedPlaces: 3, regions: 2, kmInTransit: expect.closeTo(111.19, 1) },
    });
  });

  it("answers unauthenticated for a guest before touching the database", async () => {
    const { deps, withUserContext } = makeDeps({ visitedPlaces: 0, regions: [], visits: [] });

    expect(await getMyStats(null, deps)).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
  });
});
