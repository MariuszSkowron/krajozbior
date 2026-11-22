import { describe, expect, it, vi } from "vitest";

import {
  createCommonsClient,
  isAllowedCommonsApiUrl,
  isAllowedCommonsUrl,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
} from "@/features/photos/infrastructure/commons-http";

// Atrapa serwera: funkcja `fetch` podstawiona do klienta. Żadnych prawdziwych zapytań.
const FILE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/1920px-Example.jpg";
const UA = "Test-client/1.0";

const ok = (bytes = new Uint8Array([1, 2, 3])) => new Response(bytes, { status: 200 });
const redirect = (location: string | null, status = 302) =>
  new Response(null, { status, headers: location === null ? {} : { location } });

function client(
  responses: (Response | Error)[],
  extra: { timeoutMs?: number; maxBytes?: number } = {},
) {
  const queue = [...responses];
  const calls: { url: string; init: RequestInit }[] = [];
  const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => undefined);
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();

    if (next === undefined) throw new Error("no more responses");
    if (next instanceof Error) throw next;

    return next;
  }) as unknown as typeof fetch;

  return {
    calls,
    sleep,
    fetchImpl,
    api: createCommonsClient({ userAgent: UA, fetchImpl, sleep, ...extra }),
  };
}

describe("commons client: address", () => {
  it("accepts only https on upload.wikimedia.org without credentials or a port", () => {
    expect(isAllowedCommonsUrl(new URL(FILE))).toBe(true);
    expect(isAllowedCommonsUrl(new URL("http://upload.wikimedia.org/x"))).toBe(false);
    expect(isAllowedCommonsUrl(new URL("https://commons.wikimedia.org/x"))).toBe(false);
    expect(isAllowedCommonsUrl(new URL("https://upload.wikimedia.org.evil.test/x"))).toBe(false);
    expect(isAllowedCommonsUrl(new URL("https://user:pw@upload.wikimedia.org/x"))).toBe(false);
    expect(isAllowedCommonsUrl(new URL("https://upload.wikimedia.org:8443/x"))).toBe(false);
  });

  it("refuses a bad address before any request", async () => {
    for (const address of ["not a url", "http://upload.wikimedia.org/x", "https://example.com/x"]) {
      const { api, calls } = client([]);

      expect(await api.download(address)).toEqual({ ok: false, reason: "bad_source" });
      expect(calls).toHaveLength(0);
    }
  });

  it("downloads with the user agent and without following redirects by itself", async () => {
    const { api, calls } = client([ok(new Uint8Array([9, 8, 7]))]);
    const result = await api.download(FILE);

    expect(result).toEqual({ ok: true, bytes: new Uint8Array([9, 8, 7]) });
    expect(calls[0]!.url).toBe(FILE);
    expect(calls[0]!.init.redirect).toBe("manual");
    expect(calls[0]!.init.headers).toMatchObject({ "User-Agent": UA });
  });

  it("returns an empty body for a response without one", async () => {
    const { api } = client([new Response(null, { status: 200 })]);

    expect(await api.download(FILE)).toEqual({ ok: true, bytes: new Uint8Array(0) });
  });
});

describe("commons client: redirects", () => {
  it("follows a redirect step by step inside the host (also a relative one)", async () => {
    const { api, calls } = client([
      redirect("/wikipedia/commons/thumb/b/b0/Other.jpg/1920px-Other.jpg", 301),
      redirect("https://upload.wikimedia.org/final.jpg", 307),
      ok(),
    ]);

    expect(await api.download(FILE)).toMatchObject({ ok: true });
    expect(calls.map((call) => call.url)).toEqual([
      FILE,
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Other.jpg/1920px-Other.jpg",
      "https://upload.wikimedia.org/final.jpg",
    ]);
  });

  it.each([
    ["another host", "https://evil.example/x.jpg"],
    ["a commons page", "https://commons.wikimedia.org/x"],
    ["plain http", "http://upload.wikimedia.org/x.jpg"],
    ["a host with credentials", "https://u:p@upload.wikimedia.org/x.jpg"],
    ["an address that is not one", "https://"],
  ])("refuses a redirect to %s", async (_name, location) => {
    const { api, calls } = client([redirect(location), ok()]);

    expect(await api.download(FILE)).toEqual({ ok: false, reason: "redirect_refused" });
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect without a location and more than three steps", async () => {
    expect(await client([redirect(null)]).api.download(FILE)).toEqual({
      ok: false,
      reason: "redirect_refused",
    });

    const hop = () => redirect("https://upload.wikimedia.org/next.jpg");
    const { api, calls } = client([hop(), hop(), hop(), hop(), ok()]);

    expect(await api.download(FILE)).toEqual({ ok: false, reason: "redirect_refused" });
    expect(calls).toHaveLength(4);
  });
});

describe("commons client: waiting and failures", () => {
  it("waits for Retry-After on 429 and 503 and tries again", async () => {
    const { api, sleep } = client([
      new Response(null, { status: 429, headers: { "retry-after": "2" } }),
      new Response(null, { status: 503 }),
      ok(),
    ]);

    expect(await api.download(FILE)).toMatchObject({ ok: true });
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([2000, 1000]);
  });

  it("never waits longer than five minutes", async () => {
    const { api, sleep } = client([
      new Response(null, { status: 429, headers: { "retry-after": "99999" } }),
      ok(),
    ]);

    await api.download(FILE);

    expect(sleep).toHaveBeenCalledWith(MAX_RETRY_AFTER_MS);
  });

  it("gives up with rate_limited after three waits", async () => {
    const limited = () => new Response(null, { status: 429, headers: { "retry-after": "1" } });
    const { api, sleep } = client([limited(), limited(), limited(), limited(), ok()]);

    expect(await api.download(FILE)).toEqual({ ok: false, reason: "rate_limited" });
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("reads Retry-After as seconds, as a date, or falls back to a second", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter(null)).toBe(1000);
    expect(parseRetryAfter("soon")).toBe(1000);
    expect(
      parseRetryAfter("Wed, 21 Nov 2026 10:00:10 GMT", Date.parse("Wed, 21 Nov 2026 10:00:00 GMT")),
    ).toBe(10_000);
    expect(
      parseRetryAfter("Wed, 21 Nov 2026 09:00:00 GMT", Date.parse("Wed, 21 Nov 2026 10:00:00 GMT")),
    ).toBe(0);
  });

  it("maps other statuses and a broken connection to short codes", async () => {
    expect(await client([new Response(null, { status: 404 })]).api.download(FILE)).toEqual({
      ok: false,
      reason: "http_error",
    });
    expect(await client([new Error("boom")]).api.download(FILE)).toEqual({
      ok: false,
      reason: "network_error",
    });
  });

  it("refuses a file above the limit, by the header and by counting the stream", async () => {
    const byHeader = client(
      [new Response(new Uint8Array(10), { headers: { "content-length": "999" } })],
      {
        maxBytes: 100,
      },
    );

    expect(await byHeader.api.download(FILE)).toEqual({ ok: false, reason: "too_large" });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60));
        controller.enqueue(new Uint8Array(60));
        controller.close();
      },
    });
    const counted = client([new Response(stream, { status: 200 })], { maxBytes: 100 });

    expect(await counted.api.download(FILE)).toEqual({ ok: false, reason: "too_large" });
  });

  it("times out a request that never answers", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const api = createCommonsClient({ userAgent: UA, fetchImpl, timeoutMs: 20 });

    expect(await api.download(FILE)).toEqual({ ok: false, reason: "timeout" });
  });

  it("times out a body that stops arriving", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
            },
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;
    const api = createCommonsClient({ userAgent: UA, fetchImpl, timeoutMs: 20 });

    expect(await api.download(FILE)).toEqual({ ok: false, reason: "timeout" });
  });

  it("reports a body read error that is not a timeout as a network error", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("reset"));
      },
    });

    expect(await client([new Response(stream, { status: 200 })]).api.download(FILE)).toEqual({
      ok: false,
      reason: "network_error",
    });
  });
});

describe("commons client: version lookup", () => {
  const apiAnswer = (overrides: Record<string, unknown> = {}) =>
    new Response(
      JSON.stringify({
        query: {
          pages: [
            {
              title: "File:Example.jpg",
              imageinfo: [
                {
                  timestamp: "2026-01-02T03:04:05Z",
                  url: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg",
                  width: 3000,
                  extmetadata: {
                    LicenseShortName: { value: "CC BY-SA 4.0" },
                    LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
                  },
                },
              ],
              ...overrides,
            },
          ],
        },
      }),
      { status: 200 },
    );

  it("asks the fixed API address with the user agent and without following redirects", async () => {
    const { api, calls } = client([apiAnswer()]);
    const result = await api.lookupVersion("File:Example.jpg");

    expect(result).toMatchObject({ ok: true, info: { width: 3000, fileName: "Example.jpg" } });

    const address = new URL(calls[0]!.url);

    expect(address.origin + address.pathname).toBe("https://commons.wikimedia.org/w/api.php");
    expect(address.searchParams.get("titles")).toBe("File:Example.jpg");
    expect(calls[0]!.init.redirect).toBe("manual");
    expect(calls[0]!.init.headers).toMatchObject({ "User-Agent": UA });
  });

  it("reports a missing page as a file that is gone", async () => {
    const { api } = client([apiAnswer({ missing: true, imageinfo: undefined })]);

    expect(await api.lookupVersion("File:Example.jpg")).toEqual({
      ok: false,
      reason: "file_gone",
    });
  });

  it("refuses a name that cannot be asked for, without a request", async () => {
    const { api, calls } = client([]);

    expect(await api.lookupVersion("a/b.jpg")).toEqual({ ok: false, reason: "file_gone" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a redirect", redirect("https://commons.wikimedia.org/w/api.php")],
    ["a server error", new Response(null, { status: 500 })],
    ["a body that is not JSON", new Response("<html>", { status: 200 })],
    ["an answer of another shape", new Response('{"error":{}}', { status: 200 })],
    ["a connection that breaks", new Error("boom")],
  ])("reports %s as an API error", async (_name, response) => {
    expect(await client([response]).api.lookupVersion("File:Example.jpg")).toEqual({
      ok: false,
      reason: "api_error",
    });
  });

  it("refuses an answer above the limit", async () => {
    const big = new Response("x".repeat(1024 * 1024 + 1), { status: 200 });

    expect(await client([big]).api.lookupVersion("File:Example.jpg")).toEqual({
      ok: false,
      reason: "api_error",
    });
  });

  it("waits for Retry-After on 429 and 503, and gives up after three waits", async () => {
    const waiting = client([
      new Response(null, { status: 429, headers: { "retry-after": "2" } }),
      new Response(null, { status: 503 }),
      apiAnswer(),
    ]);

    expect(await waiting.api.lookupVersion("File:Example.jpg")).toMatchObject({ ok: true });
    expect(waiting.sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([2000, 1000]);

    const limited = () => new Response(null, { status: 429, headers: { "retry-after": "1" } });
    const giving = client([limited(), limited(), limited(), limited(), apiAnswer()]);

    expect(await giving.api.lookupVersion("File:Example.jpg")).toEqual({
      ok: false,
      reason: "api_error",
    });
    expect(giving.sleep).toHaveBeenCalledTimes(3);
  });

  it("times out a request that never answers", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const api = createCommonsClient({ userAgent: UA, fetchImpl, timeoutMs: 20 });

    expect(await api.lookupVersion("File:Example.jpg")).toEqual({
      ok: false,
      reason: "api_error",
    });
  });

  it("accepts only the fixed API address", () => {
    expect(isAllowedCommonsApiUrl(new URL("https://commons.wikimedia.org/w/api.php?a=b"))).toBe(
      true,
    );
    expect(isAllowedCommonsApiUrl(new URL("http://commons.wikimedia.org/w/api.php"))).toBe(false);
    expect(isAllowedCommonsApiUrl(new URL("https://commons.wikimedia.org/w/index.php"))).toBe(
      false,
    );
    expect(isAllowedCommonsApiUrl(new URL("https://upload.wikimedia.org/w/api.php"))).toBe(false);
    expect(isAllowedCommonsApiUrl(new URL("https://u:p@commons.wikimedia.org/w/api.php"))).toBe(
      false,
    );
    expect(isAllowedCommonsApiUrl(new URL("https://commons.wikimedia.org:8443/w/api.php"))).toBe(
      false,
    );
  });
});
