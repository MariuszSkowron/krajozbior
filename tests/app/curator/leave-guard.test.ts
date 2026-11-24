import { afterEach, describe, expect, it, vi } from "vitest";

import { describeSearchFailure, searchAddress } from "@/app/curator/address-search";
import { leavingHref } from "@/app/curator/unsaved-changes";

const here = { origin: "https://krajozbior.test", pathname: "/curator/collections/1", search: "" };
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const link = (href: string, extra: { target?: string; download?: string } = {}) => ({
  href,
  target: extra.target ?? "",
  download: extra.download ?? "",
});

describe("leavingHref", () => {
  it("gives the internal address of a link that leaves the page", () => {
    expect(leavingHref(link("https://krajozbior.test/curator?x=1#a"), plain, here)).toBe(
      "/curator?x=1#a",
    );
  });

  it("stays out of the same page, other sites, new tabs, downloads and modified clicks", () => {
    expect(
      leavingHref(link("https://krajozbior.test/curator/collections/1#map"), plain, here),
    ).toBeNull();
    expect(leavingHref(link("https://example.org/"), plain, here)).toBeNull();
    expect(
      leavingHref(link("https://krajozbior.test/x", { target: "_blank" }), plain, here),
    ).toBeNull();
    expect(leavingHref(link("https://krajozbior.test/x", { target: "_self" }), plain, here)).toBe(
      "/x",
    );
    expect(leavingHref(link("https://krajozbior.test/x", { download: "" }), plain, here)).toBe(
      "/x",
    );
    expect(
      leavingHref(link("https://krajozbior.test/x", { download: "a.pdf" }), plain, here),
    ).toBeNull();
    expect(
      leavingHref(link("https://krajozbior.test/x"), { ...plain, button: 1 }, here),
    ).toBeNull();
    expect(
      leavingHref(link("https://krajozbior.test/x"), { ...plain, metaKey: true }, here),
    ).toBeNull();
    expect(
      leavingHref(link("https://krajozbior.test/x"), { ...plain, ctrlKey: true }, here),
    ).toBeNull();
    expect(
      leavingHref(link("https://krajozbior.test/x"), { ...plain, shiftKey: true }, here),
    ).toBeNull();
    expect(
      leavingHref(link("https://krajozbior.test/x"), { ...plain, altKey: true }, here),
    ).toBeNull();
  });

  it("treats an address that cannot be read as no navigation", () => {
    expect(leavingHref(link("http://"), plain, here)).toBeNull();
  });

  it("counts another query string as another page", () => {
    expect(
      leavingHref(link("https://krajozbior.test/curator/collections/1?a=1"), plain, here),
    ).toBe("/curator/collections/1?a=1");
  });
});

describe("address search request", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );

  it("says why the search failed, by status", () => {
    expect(describeSearchFailure(400)).toMatch(/co najmniej 3/);
    expect(describeSearchFailure(401)).toMatch(/Zaloguj/);
    expect(describeSearchFailure(403)).toMatch(/uprawnień/);
    expect(describeSearchFailure(429)).toMatch(/Za dużo/);
    expect(describeSearchFailure(503)).toMatch(/niedostępne/);
  });

  it("returns the results of the route", async () => {
    answer(200, { results: [{ label: "Rumia", latitude: 54.1, longitude: 18.8 }] });

    expect(await searchAddress("Rumia")).toEqual({
      ok: true,
      results: [{ label: "Rumia", latitude: 54.1, longitude: 18.8 }],
    });
  });

  it("returns an empty list when the answer has none", async () => {
    answer(200, {});

    expect(await searchAddress("Rumia")).toEqual({ ok: true, results: [] });
  });

  it("returns a sentence for a refusal, a network failure and a broken answer", async () => {
    answer(429, {});
    expect(await searchAddress("Rumia")).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Za dużo/),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    expect(await searchAddress("Rumia")).toMatchObject({ ok: false });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    expect(await searchAddress("Rumia")).toMatchObject({ ok: false });
  });
});
