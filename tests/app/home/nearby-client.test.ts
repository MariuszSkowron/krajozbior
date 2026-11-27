import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchNearbyCandidates } from "@/app/home/nearby-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchNearbyCandidates", () => {
  it("makes a plain GET of the public route, with no parameter and no body", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        candidates: [
          {
            slug: "a",
            title: "A",
            region: "pomorskie",
            placeCount: 1,
            points: [[54.1, 18.2]],
            firstPublishedAt: null,
          },
        ],
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchNearbyCandidates()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/nearby");
  });

  it("throws on an error status and on a malformed body", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }));
    await expect(fetchNearbyCandidates()).rejects.toThrow();

    vi.stubGlobal("fetch", async () => Response.json({ candidates: "no" }));
    await expect(fetchNearbyCandidates()).rejects.toThrow();
  });
});
