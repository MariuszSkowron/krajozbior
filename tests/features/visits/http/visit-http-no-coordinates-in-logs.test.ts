import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/features/identity/domain/actor";
import type { VisitDeps, VisitFunctionRow } from "@/features/visits/application/visit-types";

// E2-S4-T3 (docs#106): the position of the device (latitude, longitude,
// accuracy) must never reach a log or an error answer. The handler is run with
// every outcome and every console channel is checked for the test values.

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const PLACE = "22222222-2222-4222-8222-222222222222";
const LATITUDE = 54.371234567;
const LONGITUDE = 18.612345678;
const ACCURACY = 12.3456;
const INACCURATE = 250.7654;
const SECRETS = ["54.371234567", "18.612345678", "12.3456", "250.7654"];
const clientVisitId = "55555555-5555-4555-8555-555555555555";

const state = vi.hoisted(() => ({
  actor: null as unknown,
  deps: null as unknown,
}));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: async () => state.actor }),
}));
vi.mock("@/features/visits/infrastructure/visit-deps", () => ({
  getVisitDeps: () => state.deps,
}));

const { handleVisitRequest } = await import("@/features/visits/http/visit-http");

const CHANNELS = ["log", "info", "warn", "error", "debug", "trace"] as const;

function makeDeps(options: {
  row?: VisitFunctionRow;
  failure?: unknown;
  allowed?: boolean;
}): VisitDeps {
  const row = options.row ?? { result: "recorded", distance_m: 31 };

  return {
    withUserContext: async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
      work({} as never),
    limiter: {
      reserve: async () =>
        options.allowed === false
          ? { allowed: false as const, retryAfterSeconds: 9 }
          : { allowed: true as const },
    },
    repository: {
      findOwnVisitPlaceId: async () => null,
      hasVisitedPlace: async () => false,
      recordOnSiteVisit: async () => {
        if (options.failure !== undefined) {
          throw options.failure;
        }

        return row;
      },
    },
    album: {
      listSavedCollections: async () => [],
      listSavedCollectionPlaces: async () => [],
      listVisitedPlaceIds: async () => [],
    },
  } as unknown as VisitDeps;
}

function post(body: unknown, placeId = PLACE): Promise<Response> {
  return handleVisitRequest(
    new Request(`http://localhost/api/places/${placeId}/visits`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    placeId,
  );
}

const validBody = (accuracy = ACCURACY) => ({
  latitude: LATITUDE,
  longitude: LONGITUDE,
  accuracy,
  clientVisitId,
});

describe("visit confirmation never exposes the position of the device", () => {
  const spies = new Map<string, { mock: { calls: unknown[][] } }>();

  beforeEach(() => {
    state.actor = actor;
    for (const channel of CHANNELS) {
      spies.set(
        channel,
        vi.spyOn(console, channel).mockImplementation(() => undefined),
      );
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    spies.clear();
  });

  const loggedText = (): string =>
    [...spies.values()]
      .flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call)))
      .join("\n");

  const expectClean = (text: string, allowed: readonly string[] = []) => {
    for (const secret of SECRETS.filter((value) => !allowed.includes(value))) {
      expect(text).not.toContain(secret);
    }
  };

  it("recorded visit: nothing logged, no position in the answer", async () => {
    state.deps = makeDeps({});
    const response = await post(validBody());
    const text = await response.text();

    expect(response.status).toBe(201);
    expectClean(text);
    expectClean(loggedText());
  });

  it("out of range: the answer holds the distance only", async () => {
    state.deps = makeDeps({ row: { result: "out_of_range", distance_m: 480 } });
    const response = await post(validBody());
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ result: "out_of_range", distanceM: 480 });
    expectClean(text);
    expectClean(loggedText());
  });

  it("too inaccurate: the own accuracy is shown to the person, but never logged", async () => {
    state.deps = makeDeps({ row: { result: "inaccurate", distance_m: null } });
    const response = await post(validBody(INACCURATE));
    const text = await response.text();

    expect(response.status).toBe(200);
    expectClean(text, ["250.7654"]);
    expectClean(loggedText());
  });

  it("validation error: 400 without echoing the input", async () => {
    state.deps = makeDeps({});
    const response = await post({ ...validBody(), latitude: 91.371234567 });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: "invalid" });
    expectClean(text);
    expectClean(loggedText());
    expect(loggedText()).not.toContain("91.371234567");
  });

  it("body that is not JSON or is too large: nothing echoed or logged", async () => {
    state.deps = makeDeps({});
    const broken = await post(`{"latitude": ${LATITUDE}, "longitude": ${LONGITUDE}, `);
    const huge = await post(JSON.stringify({ ...validBody(), pad: "x".repeat(20000) }));

    for (const response of [broken, huge]) {
      expectClean(await response.text());
    }
    expectClean(loggedText());
  });

  it("rate limited: the answer and the logs hold no position", async () => {
    state.deps = makeDeps({ allowed: false });
    const response = await post(validBody());

    expect(response.status).toBe(429);
    expectClean(await response.text());
    expectClean(loggedText());
  });

  it("database error whose message carries the query parameters: 503 and only the error class logged", async () => {
    const failure = Object.assign(
      new Error(
        `select ... record_on_site_visit($1, ${LATITUDE}, ${LONGITUDE}, ${ACCURACY}) failed; params: [${LATITUDE}, ${LONGITUDE}, ${ACCURACY}]`,
      ),
      { name: "DriverException", params: [LATITUDE, LONGITUDE, ACCURACY] },
    );

    state.deps = makeDeps({ failure });
    const response = await post(validBody());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    expectClean(text);
    expect(loggedText()).toContain("DriverException");
    expectClean(loggedText());
  });

  it("a thrown non-Error value is logged as an unknown error", async () => {
    state.deps = makeDeps({ failure: `lat=${LATITUDE} lng=${LONGITUDE}` });
    const response = await post(validBody());

    expect(response.status).toBe(503);
    expectClean(await response.text());
    expectClean(loggedText());
  });
});
