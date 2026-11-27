import { describe, expect, it, vi } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { searchAddress } from "@/features/catalog/application/curator-geocode";

// Wyszukiwanie adresu (K-2): aktor z sesji, limit przed resztą, członkostwo w organizacji,
// kształt zapytania. Usługa geokodowania jest podstawiona; żadnych prawdziwych zapytań.
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const found = [{ label: "Rumia", latitude: 54.09, longitude: 18.79 }];

function setup(options: { organizationIds?: string[]; allowed?: boolean } = {}) {
  const reserve = vi.fn(async () =>
    options.allowed === false
      ? { allowed: false as const, retryAfterSeconds: 9 }
      : { allowed: true as const },
  );
  const geocode = vi.fn(async () => found);
  const deps = {
    withUserContext: (_who: unknown, work: (tx: unknown) => Promise<unknown>) => work({}),
    limiter: { reserve },
    repository: { permittedOrganizationIds: async () => options.organizationIds ?? ["org"] },
  } as unknown as CatalogDeps;

  return { deps, reserve, geocode };
}

describe("searchAddress", () => {
  it("answers unauthenticated for a guest and asks nobody", async () => {
    const { deps, reserve, geocode } = setup();

    expect(await searchAddress(null, { query: "Rumia" }, deps, geocode)).toEqual({
      status: "unauthenticated",
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(geocode).not.toHaveBeenCalled();
  });

  it("answers rate_limited past the limit, without asking the service", async () => {
    const { deps, geocode } = setup({ allowed: false });

    expect(await searchAddress(actor, { query: "Rumia" }, deps, geocode)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 9,
    });
    expect(geocode).not.toHaveBeenCalled();
  });

  it("answers forbidden for an account that is no curator, without asking the service", async () => {
    const { deps, geocode } = setup({ organizationIds: [] });

    expect(await searchAddress(actor, { query: "Rumia" }, deps, geocode)).toEqual({
      status: "forbidden",
    });
    expect(geocode).not.toHaveBeenCalled();
  });

  it("refuses a query that is too short or not a text", async () => {
    const { deps, geocode } = setup();

    expect(await searchAddress(actor, { query: "ab" }, deps, geocode)).toEqual({
      status: "invalid",
      errors: ["query"],
    });
    expect(await searchAddress(actor, {}, deps, geocode)).toEqual({
      status: "invalid",
      errors: ["query"],
    });
    expect(geocode).not.toHaveBeenCalled();
  });

  it("sends only the trimmed query and returns what the service found", async () => {
    const { deps, reserve, geocode } = setup();

    expect(await searchAddress(actor, { query: "  Rumia  ", other: "x" }, deps, geocode)).toEqual({
      status: "ok",
      value: { results: found },
    });
    expect(geocode).toHaveBeenCalledWith("Rumia");
    expect(reserve).toHaveBeenCalledWith("curator_geocode", actor.id, expect.anything());
  });

  it("asks the service only after the database transaction has closed", async () => {
    const { deps, reserve } = setup();
    const events: string[] = [];
    const tracked = {
      ...deps,
      withUserContext: async (_who: unknown, work: (tx: unknown) => Promise<unknown>) => {
        events.push("open");
        try {
          return await work({});
        } finally {
          events.push("closed");
        }
      },
    } as unknown as CatalogDeps;

    await searchAddress(actor, { query: "Rumia" }, tracked, async () => {
      events.push("geocode");
      return found;
    });

    expect(reserve).toHaveBeenCalled();
    expect(events).toEqual(["open", "closed", "geocode"]);
  });

  it("lets a failure of the service reach the route (503)", async () => {
    const { deps } = setup();

    await expect(
      searchAddress(actor, { query: "Rumia" }, deps, async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
  });
});
