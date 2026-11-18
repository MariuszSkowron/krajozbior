import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NearbyCandidate } from "@/features/catalog/domain/nearby";

// No DOM in unit tests: the hooks are replaced by a small store that survives repeated calls of
// the component function (the same approach as tests/app/visit-confirmation.test.ts).
const store = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, supported: true }));

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
  useSyncExternalStore: () => store.supported,
}));

const { NearbyCollections } = await import("@/app/home/nearby-collections");

const candidates: NearbyCandidate[] = [
  {
    slug: "blisko",
    title: "Blisko",
    region: "pomorskie",
    placeCount: 3,
    centerLat: 54.1,
    centerLon: 18,
    firstPublishedAt: null,
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

  return NearbyCollections({ candidates }) as ReactElement;
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
  store.supported = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NearbyCollections", () => {
  it("shows only the button before a click and does not read the position, even when it could", () => {
    const geolocation = stubGeolocation((success) => success(reading(54.1, 18)));
    const markup = html();

    expect(markup).toMatch(/<button [^>]*>Pokaż kolekcje w okolicy<\/button>/);
    expect(markup).toMatch(/<p role="status"><\/p>/);
    expect(markup).not.toContain("/collections/");
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
    expect(html()).toMatch(/<p role="status">Ustalam Twoje położenie…<\/p>/);
    expect(html()).toContain('aria-disabled="true"');

    // A second click while locating does not start another reading.
    click();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("lists the nearby collections with the distance, and keeps the far one out", () => {
    stubGeolocation((success) => success(reading(54, 18)));
    click();

    const markup = html();

    expect(markup).toContain("Jedna kolekcja w promieniu 50 km.");
    expect(markup).toContain('href="/collections/blisko"');
    expect(markup).toContain("11 km · 3 miejsca");
    expect(markup).not.toContain("/collections/daleko");
    expect(markup).toContain("Sprawdź ponownie");
    // Neither the position nor the accuracy is kept anywhere in the markup.
    expect(markup).not.toMatch(/54\.0|18\.0/);
  });

  it("says when the reading is coarse, and when no collection lies in the radius", () => {
    stubGeolocation((success) => success(reading(54, 18, 8000)));
    click();
    expect(html()).toContain("Lokalizacja jest niedokładna");

    stubGeolocation((success) => success(reading(0, 0)));
    click();

    const markup = html();

    expect(markup).toContain("W promieniu 50 km nie ma jeszcze kolekcji.");
    expect(markup).toMatch(/<a [^>]*href="\/search"[^>]*>Zobacz wszystkie kolekcje<\/a>/);
    expect(markup).not.toContain("/collections/");
  });

  it.each([
    [1, "Nie mamy dostępu do lokalizacji. Możesz włączyć go w ustawieniach przeglądarki."],
    [2, "Nie udało się ustalić Twojego położenia. Spróbuj ponownie."],
    [3, "Ustalanie położenia trwało zbyt długo. Spróbuj ponownie."],
  ])(
    "explains a refusal or failure (code %s) and offers the list of all collections",
    (code, text) => {
      stubGeolocation((_success, fail) => fail({ code }));
      click();

      const markup = html();

      expect(markup).toContain(`<p role="status">${text}</p>`);
      expect(markup).toContain('href="/search"');
      expect(markup).toContain("Sprawdź ponownie");
    },
  );

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
    const source = await readFile("src/app/home/nearby-collections.tsx", "utf8");

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

  it("shows only the link when the browser has no geolocation", () => {
    store.supported = false;

    const markup = html();

    expect(markup).toContain("Ta przeglądarka nie obsługuje lokalizacji.");
    expect(markup).toContain('href="/search"');
    expect(markup).not.toContain("<button");
  });

  it("shows a message and no button when the list could not be read", () => {
    store.cursor = 0;

    const markup = renderToStaticMarkup(NearbyCollections({ candidates: null }) as ReactElement);

    expect(markup).toMatch(/role="alert"[^>]*>Nie udało się wczytać kolekcji\. Odśwież stronę\./);
    expect(markup).not.toContain("<button");

    // A click handler is never reachable without a list; the guard is harmless anyway.
    const geolocation = stubGeolocation(() => undefined);

    expect(findButton(NearbyCollections({ candidates: null }) as ReactElement)).toBeNull();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});
