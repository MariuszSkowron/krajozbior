import { describe, expect, it, vi } from "vitest";

import type { NewsReadDeps, PublicNewsCard } from "@/features/news/application/news-read-types";
import {
  getPublicNews,
  listLatestNews,
  listPublicNews,
} from "@/features/news/application/public-news";

type Row = Omit<PublicNewsCard, "verification">;

const row = (overrides: Partial<Row> & { slug: string }): Row => ({
  kind: "guide",
  title: `Tytuł ${overrides.slug}`,
  lead: "Krótki tekst.",
  publishedAt: new Date("2026-11-20T10:00:00Z"),
  eventStartsOn: null,
  eventEndsOn: null,
  organization: { name: "Krajozbiór — redakcja", slug: "krajozbior-redakcja" },
  cover: null,
  ...overrides,
});

function deps(rows: readonly Row[], item: unknown = null) {
  const listPublished = vi.fn(async () => rows);
  const findPublished = vi.fn(async () => item);
  const withGuestContext = vi.fn(async (work: (tx: never) => Promise<unknown>) =>
    work({} as never),
  );

  return {
    listPublished,
    findPublished,
    withGuestContext,
    value: {
      withGuestContext,
      repository: { listPublished, findPublished },
    } as unknown as NewsReadDeps,
  };
}

const now = new Date("2026-11-22T12:00:00Z");

describe("listLatestNews", () => {
  it("asks the database for only the requested number of items, in the guest context", async () => {
    const d = deps([
      row({ slug: "a" }),
      row({ slug: "b", organization: { name: "Gmina Tczew", slug: "gmina-tczew" } }),
    ]);

    const cards = await listLatestNews(3, d.value);

    expect(d.withGuestContext).toHaveBeenCalledTimes(1);
    expect(d.listPublished).toHaveBeenCalledWith(expect.anything(), null, 3);
    expect(cards.map((card) => [card.slug, card.verification])).toEqual([
      ["a", "editorial"],
      ["b", "verified"],
    ]);
  });
});

describe("listPublicNews", () => {
  it("reads in the guest context and marks the team and other organizations", async () => {
    const d = deps([
      row({ slug: "a" }),
      row({ slug: "b", organization: { name: "Gmina Tczew", slug: "gmina-tczew" } }),
    ]);

    const cards = await listPublicNews(null, d.value, now);

    expect(d.withGuestContext).toHaveBeenCalledTimes(1);
    expect(d.listPublished).toHaveBeenCalledWith(expect.anything(), null, 50);
    expect(cards.map((card) => [card.slug, card.verification])).toEqual([
      ["a", "editorial"],
      ["b", "verified"],
    ]);
  });

  it("keeps only events that are on or still to come for the filter, soonest first", async () => {
    const d = deps([
      row({
        slug: "minione",
        kind: "event",
        eventStartsOn: "2026-11-01",
        eventEndsOn: "2026-11-02",
      }),
      row({ slug: "pozniej", kind: "event", eventStartsOn: "2027-03-01" }),
      row({ slug: "trwa", kind: "event", eventStartsOn: "2026-11-21", eventEndsOn: "2026-11-23" }),
      row({ slug: "dzis", kind: "event", eventStartsOn: "2026-11-22" }),
    ]);

    const cards = await listPublicNews("events", d.value, now);

    expect(d.listPublished).toHaveBeenCalledWith(expect.anything(), "event", 200);
    expect(cards.map((card) => card.slug)).toEqual(["trwa", "dzis", "pozniej"]);
  });

  it("returns no more than the list limit after the filter", async () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      row({
        slug: `w-${String(index).padStart(2, "0")}`,
        kind: "event",
        eventStartsOn: "2027-01-01",
      }),
    );

    expect(await listPublicNews("events", deps(many).value, now)).toHaveLength(50);
  });

  it("uses the clock of the caller when none is given", async () => {
    const far = row({ slug: "daleko", kind: "event", eventStartsOn: "2099-01-01" });
    const past = row({ slug: "dawno", kind: "event", eventStartsOn: "2000-01-01" });

    const cards = await listPublicNews("events", deps([past, far]).value);

    expect(cards.map((card) => card.slug)).toEqual(["daleko"]);
  });

  it("propagates a failure of the database to the page", async () => {
    const failing = {
      withGuestContext: async () => {
        throw new Error("db down");
      },
    } as unknown as NewsReadDeps;

    await expect(listPublicNews(null, failing, now)).rejects.toThrow("db down");
  });
});

describe("getPublicNews", () => {
  const item = {
    ...row({ slug: "jak-zbierac" }),
    body: "Treść",
    contentUpdatedAt: null,
    collection: null,
    place: null,
  };

  it("returns the item with the mark of its organization", async () => {
    const d = deps([], item);

    expect(await getPublicNews("jak-zbierac", d.value)).toEqual({
      status: "ok",
      value: { ...item, verification: "editorial" },
    });
    expect(d.findPublished).toHaveBeenCalledWith(expect.anything(), "jak-zbierac");
  });

  it("passes the cover through unchanged", async () => {
    const cover = { photoId: "p", width: 1, height: 1, altText: "a" };

    expect(await listPublicNews(null, deps([row({ slug: "z", cover })]).value, now)).toMatchObject([
      { cover },
    ]);
    expect(await listPublicNews(null, deps([row({ slug: "n" })]).value, now)).toMatchObject([
      { cover: null },
    ]);
  });

  it("marks an organization other than the team as verified", async () => {
    const other = { ...item, organization: { name: "Gmina", slug: "gmina" } };

    expect(await getPublicNews("jak-zbierac", deps([], other).value)).toMatchObject({
      value: { verification: "verified" },
    });
  });

  it("is not found when the database has no published item with that address", async () => {
    expect(await getPublicNews("nie-ma", deps([], null).value)).toEqual({ status: "not_found" });
  });

  it.each(["", "Zły adres", "x".repeat(81), "../etc"])(
    "does not query the database for the address %j",
    async (slug) => {
      const d = deps([], item);

      expect(await getPublicNews(slug, d.value)).toEqual({ status: "not_found" });
      expect(d.withGuestContext).not.toHaveBeenCalled();
    },
  );
});
