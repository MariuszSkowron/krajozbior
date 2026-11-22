import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecentCollection } from "@/features/catalog/application/catalog-types";
import type { NearbyCandidate } from "@/features/catalog/domain/nearby";

// No DOM in unit tests: the hooks are replaced by a small store that survives repeated calls of
// the component function (the same approach as tests/app/visit-confirmation.test.ts).
const store = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  support: "supported" as "pending" | "supported" | "unsupported",
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = store.cursor++;

    if (!(index in store.values)) {
      store.values[index] = initial;
    }

    return [
      store.values[index],
      (value: unknown) => {
        store.values[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = store.cursor++;

    if (!(index in store.values)) {
      store.values[index] = { current: initial };
    }

    return store.values[index];
  },
  useSyncExternalStore: () => store.support,
}));

const { CollectionsToDiscover } = await import("@/app/home/collections-to-discover");

// "Kolekcje do odkrycia" (K-34): one list, sorted by distance after a click. The list of the
// server is in the order "newest first": "daleko" first, so a sort by distance is visible.
const collections: RecentCollection[] = [
  {
    id: "c-daleko",
    slug: "daleko",
    title: "Daleko",
    region: "malopolskie",
    organization: { name: "Gmina B" },
    placeCount: 1,
    cover: null,
  },
  {
    id: "c-bez",
    slug: "bez-miejsc",
    title: "Bez miejsc",
    region: "lodzkie",
    organization: { name: "Gmina D" },
    placeCount: 0,
    cover: null,
  },
  {
    id: "c-blisko",
    slug: "blisko",
    title: "Blisko",
    region: "pomorskie",
    organization: { name: "Gmina A" },
    placeCount: 3,
    cover: null,
  },
];

const candidates: NearbyCandidate[] = [
  {
    slug: "blisko",
    title: "Blisko",
    region: "pomorskie",
    placeCount: 3,
    centerLat: 54.1,
    centerLon: 18,
    firstPublishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    slug: "daleko",
    title: "Daleko",
    region: "malopolskie",
    placeCount: 1,
    centerLat: 50,
    centerLon: 20,
    firstPublishedAt: null,
  },
];

type Props = { onClick?: () => void; "aria-disabled"?: boolean; children?: ReactNode };

function findButton(node: ReactNode): ReactElement<Props> | null {
  if (node === null || typeof node !== "object") {
    return null;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child as ReactNode);

      if (found !== null) {
        return found;
      }
    }

    return null;
  }

  const element = node as ReactElement<Props>;

  return element.type === "button" ? element : findButton(element.props?.children);
}

function render() {
  store.cursor = 0;

  return CollectionsToDiscover({ collections, candidates }) as ReactElement;
}

const html = () => renderToStaticMarkup(render());

type Geolocation = { getCurrentPosition: ReturnType<typeof vi.fn> };

function stubGeolocation(
  behaviour: (success: (p: unknown) => void, fail: (e: unknown) => void) => void,
) {
  const geolocation: Geolocation = {
    getCurrentPosition: vi.fn((success, fail) => behaviour(success, fail)),
  };

  vi.stubGlobal("navigator", { geolocation });

  return geolocation;
}

const reading = (latitude: number, longitude: number, accuracy = 20) => ({
  coords: { latitude, longitude, accuracy },
});

function click() {
  findButton(render())?.props.onClick?.();
}

beforeEach(() => {
  store.values = [];
  store.cursor = 0;
  store.support = "supported";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const order = (markup: string) =>
  [...markup.matchAll(/href="\/collections\/([^"]+)"/g)].map((match) => match[1]);

describe("CollectionsToDiscover", () => {
  it("shows the list in the server order and the button, and does not read the position before a click", () => {
    const geolocation = stubGeolocation((success) => success(reading(54.1, 18)));
    const markup = html();

    expect(markup).toMatch(/<h2[^>]*>Kolekcje do odkrycia<\/h2>/);
    expect(markup).toMatch(/<a [^>]*href="\/search"[^>]*>Wszystkie kolekcje<\/a>/);
    expect(markup).toMatch(/<button [^>]*>Pokaż najbliższe<\/button>/);
    expect(markup).toContain("Położenie zostaje w tej przeglądarce.");
    expect(markup).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(order(markup)).toEqual(["daleko", "bez-miejsc", "blisko"]);
    expect(markup).not.toContain("Nowa w okolicy");
    expect(markup).not.toContain(" km · ");
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("reads the position once, only after a click, with a rough and bounded request", () => {
    const geolocation = stubGeolocation(() => undefined);

    click();

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geolocation.getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 600_000,
    });
    expect(html()).toMatch(/<p role="status"[^>]*>Ustalamy Twoje położenie…<\/p>/);
    expect(html()).toContain('aria-disabled="true"');

    // A second click while locating does not start another reading.
    click();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("sorts the same list by distance (nearest first, one without a distance last) and keeps the far one", () => {
    stubGeolocation((success) => success(reading(54, 18)));
    click();

    const markup = html();

    expect(markup).toContain("Kolekcje od najbliższej.");
    expect(order(markup)).toEqual(["blisko", "daleko", "bez-miejsc"]);
    expect(markup).toContain("11 km · 3 miejsca · Gmina A");
    expect(markup).toMatch(/\d{3} km · 1 miejsce · Gmina B/);
    expect(markup).toContain("0 miejsc · Gmina D");
    expect(markup.match(/Nowa w okolicy/g)).toHaveLength(1);
    expect(markup).toContain("Sprawdź ponownie");
    // Neither the position nor the accuracy is kept anywhere in the markup.
    expect(markup).not.toMatch(/54\.0|18\.0/);
  });

  it("marks only a collection published within 30 days; an old or never published one has no mark", () => {
    stubGeolocation((success) => success(reading(54, 18)));

    const day = 24 * 60 * 60 * 1000;
    const withDates = (dates: (string | null)[]) =>
      dates.map((firstPublishedAt, index) => ({
        ...candidates[0]!,
        slug: `c${index}`,
        title: `C${index}`,
        firstPublishedAt,
      }));
    const run = (list: NearbyCandidate[]) => {
      const own = list.map((candidate) => ({
        ...collections[2]!,
        id: candidate.slug,
        slug: candidate.slug,
        title: candidate.title,
      }));

      store.values = [];
      store.cursor = 0;
      findButton(
        CollectionsToDiscover({ collections: own, candidates: list }) as ReactElement,
      )?.props.onClick?.();
      store.cursor = 0;

      return renderToStaticMarkup(
        CollectionsToDiscover({ collections: own, candidates: list }) as ReactElement,
      );
    };

    const old = run(withDates([new Date(Date.now() - 31 * day).toISOString(), null, "nie data"]));

    expect(old).toContain("/collections/c0");
    expect(old).not.toContain("Nowa w okolicy");
    expect(run(withDates([new Date(Date.now() - 29 * day).toISOString(), null]))).toContain(
      "Nowa w okolicy",
    );
  });

  it("says when the reading is coarse, and does not drop a collection that lies far away", () => {
    stubGeolocation((success) => success(reading(54, 18, 8000)));
    click();
    expect(html()).toContain("Położenie jest niedokładne");

    // From the other end of the world every collection is still on the list, nearest first.
    stubGeolocation((success) => success(reading(-40, 170)));
    click();

    expect(order(html())).toHaveLength(3);
  });

  it.each([
    [1, "Nie mamy zgody na użycie lokalizacji. Włączysz ją w ustawieniach przeglądarki."],
    [2, "Nie udało się ustalić Twojego położenia. Spróbuj ponownie."],
    [3, "Ustalanie położenia trwało zbyt długo. Spróbuj ponownie."],
  ])(
    "explains a refusal or failure (code %s) and offers the list of all collections",
    (code, text) => {
      stubGeolocation((_success, fail) => fail({ code }));
      click();

      const markup = html();

      expect(markup).toMatch(new RegExp(`<p role="status"[^>]*>${text}</p>`));
      expect(markup).toContain('href="/search"');
      // The list stays whole in the original order.
      expect(order(markup)).toEqual(["daleko", "bez-miejsc", "blisko"]);
      expect(markup).toContain("Sprawdź ponownie");
    },
  );

  it("gives up after its own time limit when the browser never answers, and ignores a late answer", () => {
    vi.useFakeTimers();

    try {
      let late: (p: unknown) => void = () => undefined;
      const geolocation = stubGeolocation((success) => {
        late = success;
      });

      click();
      vi.advanceTimersByTime(11_999);
      expect(html()).toContain("Ustalamy Twoje położenie…");

      vi.advanceTimersByTime(1);

      const markup = html();

      expect(markup).toMatch(
        /<p role="status"[^>]*>Ustalanie położenia trwało zbyt długo\. Spróbuj ponownie\.<\/p>/,
      );
      expect(markup).toContain("Sprawdź ponownie");
      expect(markup).not.toContain('aria-disabled="true"');

      // The answer that comes after the limit changes nothing.
      late(reading(54, 18));
      expect(html()).toContain("Ustalanie położenia trwało zbyt długo");
      expect(html()).not.toContain(" km · ");

      // And the explorer can try again.
      click();
      expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can try again after a refusal", () => {
    const geolocation = stubGeolocation((_success, fail) => fail({ code: 1 }));

    click();
    click();

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  // D-14: the position never leaves the component: no request, no storage, no log, no address.
  it("sends, stores and logs no coordinates in any outcome", () => {
    const LAT = 54.371234567;
    const LON = 18.612345678;
    const fetchSpy = vi.fn();
    const sent = vi.fn();
    const channels = ["log", "info", "warn", "error", "debug", "trace"] as const;
    const spies = channels.map((channel) =>
      vi.spyOn(console, channel).mockImplementation(() => {}),
    );
    const storage = { getItem: sent, setItem: sent, removeItem: sent };

    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("history", { pushState: sent, replaceState: sent });
    vi.stubGlobal("location", { assign: sent, replace: sent, href: "http://x/" });
    vi.stubGlobal("document", { cookie: "" });

    for (const behaviour of [
      (success: (p: unknown) => void) => success(reading(LAT, LON, 12.3456)),
      (_success: (p: unknown) => void, fail: (e: unknown) => void) => fail({ code: 1 }),
    ]) {
      stubGeolocation(behaviour);
      store.values = [];
      click();

      const markup = html();

      expect(markup).not.toContain("54.37");
      expect(markup).not.toContain("18.61");
      expect(markup).not.toContain("12.3456");
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sent).not.toHaveBeenCalled();
    expect((globalThis.document as unknown as { cookie: string }).cookie).toBe("");
    expect(JSON.stringify(spies.flatMap((spy) => spy.mock.calls))).not.toMatch(/54\.37|18\.61/);
    spies.forEach((spy) => spy.mockRestore());
  });

  it("has no code path that could send or store a position (source check)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/app/home/collections-to-discover.tsx", "utf8");

    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "sendBeacon",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "console.",
      "useRouter",
      "next/navigation",
      "searchParams",
      "watchPosition",
      "use server",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("leaves the button out before the component is ready in the browser (server and hydration)", () => {
    store.support = "pending";

    const markup = html();

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("Położenie zostaje w tej przeglądarce.");
    expect(markup).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(order(markup)).toEqual(["daleko", "bez-miejsc", "blisko"]);
    expect(markup).toContain('href="/search"');
  });

  it("keeps the list and the link, and offers no button, when the browser has no geolocation", () => {
    store.support = "unsupported";

    const markup = html();

    expect(markup).toContain("Ta przeglądarka nie obsługuje lokalizacji.");
    expect(markup).toContain('href="/search"');
    expect(markup).not.toContain("<button");
    expect(order(markup)).toHaveLength(3);
  });

  it("keeps the list without a button when only the positions could not be read", () => {
    store.cursor = 0;

    const markup = renderToStaticMarkup(
      CollectionsToDiscover({ collections, candidates: null }) as ReactElement,
    );

    expect(order(markup)).toHaveLength(3);
    expect(markup).not.toContain("<button");

    // A click handler is never reachable without positions; the guard is harmless anyway.
    const geolocation = stubGeolocation(() => undefined);

    expect(
      findButton(CollectionsToDiscover({ collections, candidates: null }) as ReactElement),
    ).toBeNull();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("shows a message and no button when the list could not be read", () => {
    store.cursor = 0;

    const markup = renderToStaticMarkup(
      CollectionsToDiscover({ collections: null, candidates }) as ReactElement,
    );

    expect(markup).toMatch(/role="alert"[^>]*>Nie udało się wczytać kolekcji\. Odśwież stronę\./);
    expect(markup).not.toContain("<button");
    expect(markup).toMatch(/<a [^>]*href="\/search"[^>]*>Wszystkie kolekcje<\/a>/);
  });

  it("says so, with no button, when there are no published collections yet", () => {
    store.cursor = 0;

    const markup = renderToStaticMarkup(
      CollectionsToDiscover({ collections: [], candidates }) as ReactElement,
    );

    expect(markup).toContain("Nie ma jeszcze opublikowanych kolekcji.");
    expect(markup).not.toContain("<button");
  });
});
