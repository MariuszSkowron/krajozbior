import { describe, expect, it, vi } from "vitest";

import {
  createNominatimGeocoder,
  GeocoderBusyError,
} from "@/features/catalog/infrastructure/nominatim-geocoder";

// The public geocoder is never called: `fetch` and the clock are replaced.
const body = [{ lat: "54.0928", lon: "18.7919", display_name: "Rumia" }];

function clock() {
  let now = 1_000_000;
  const sleeps: number[] = [];

  return {
    sleeps,
    value: {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    },
  };
}

describe("createNominatimGeocoder", () => {
  it("asks the service with a generic User-Agent and only the typed text", async () => {
    const fetchImpl = vi.fn(async () => Response.json(body));
    const geocode = createNominatimGeocoder(fetchImpl as unknown as typeof fetch, clock().value);

    expect(await geocode("ul. Dworcowa 1, Rumia")).toEqual([
      { label: "Rumia", latitude: 54.0928, longitude: 18.7919 },
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];

    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(url.searchParams.get("q")).toBe("ul. Dworcowa 1, Rumia");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("countrycodes")).toBe("pl");
    expect(String((init.headers as Record<string, string>)["User-Agent"])).toMatch(/^Krajozbior\//);
    expect(init.redirect).toBe("error");
  });

  it("leaves no unhandled rejection when a search fails, and the next one still runs", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);

    process.on("unhandledRejection", onUnhandled);

    try {
      let calls = 0;
      const fetchImpl = vi.fn(async () => {
        calls += 1;

        if (calls === 1) {
          throw new Error("network down");
        }

        return Response.json(body);
      });
      const geocode = createNominatimGeocoder(fetchImpl as unknown as typeof fetch, clock().value);

      await expect(geocode("Rumia")).rejects.toThrow("network down");
      // Give Node the chance to report a rejected promise nobody handles.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(await geocode("Gdynia")).toHaveLength(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("keeps more than a second between two requests", async () => {
    const time = clock();
    const geocode = createNominatimGeocoder(
      (async () => Response.json(body)) as unknown as typeof fetch,
      time.value,
    );

    await Promise.all([geocode("Rumia"), geocode("Gdynia")]);

    expect(time.sleeps).toHaveLength(1);
    expect(time.sleeps[0]).toBeGreaterThanOrEqual(1000);
  });

  it("throws when the service answers with an error and goes on with the next search", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;

      return calls === 1 ? new Response("no", { status: 503 }) : Response.json(body);
    });
    const geocode = createNominatimGeocoder(fetchImpl as unknown as typeof fetch, clock().value);

    await expect(geocode("Rumia")).rejects.toThrow("503");
    expect(await geocode("Rumia")).toHaveLength(1);
  });

  it("refuses at once when too many searches are waiting", async () => {
    const geocode = createNominatimGeocoder(
      (async () => Response.json(body)) as unknown as typeof fetch,
      clock().value,
    );
    const batch = Array.from({ length: 6 }, () =>
      geocode("Rumia").catch((error: unknown) => error),
    );
    const answers = await Promise.all(batch);

    expect(answers.filter((answer) => answer instanceof GeocoderBusyError)).toHaveLength(2);
  });
});
