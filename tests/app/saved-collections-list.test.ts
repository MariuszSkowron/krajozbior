import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in unit tests: the hooks are replaced by a small store (as in nearby-collections.test.ts).
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

const { SavedCollectionsList } = await import("@/app/my/collections/saved-collections-list");
type Item = import("@/app/my/collections/saved-collections-list").SavedCollectionItem;

const DAY = 24 * 60 * 60 * 1000;
const item = (slug: string, overrides: Partial<Item> = {}): Item => ({
  slug,
  title: slug,
  regionLabel: "Pomorskie",
  visited: 1,
  total: 3,
  centerLat: 54.1,
  centerLon: 18,
  firstPublishedAt: new Date(Date.now() - 3 * DAY).toISOString(),
  ...overrides,
});

const items: Item[] = [
  item("nowa-blisko"),
  item("stara-blisko", { firstPublishedAt: new Date(Date.now() - 40 * DAY).toISOString() }),
  item("nowa-daleko", { centerLat: 50, centerLon: 20 }),
  item("ogolnopolska", { centerLat: null, centerLon: null, firstPublishedAt: null }),
];

type Props = { onClick?: () => void; children?: ReactNode };

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

function render(offerNearby = true) {
  store.cursor = 0;

  return SavedCollectionsList({ items, offerNearby }) as ReactElement;
}

const html = (offerNearby = true) => renderToStaticMarkup(render(offerNearby));
const click = () => findButton(render())?.props.onClick?.();

function stubGeolocation(
  behaviour: (success: (p: unknown) => void, fail: (e: unknown) => void) => void,
) {
  const getCurrentPosition: ReturnType<typeof vi.fn> = vi.fn((success, fail) =>
    behaviour(success, fail),
  );

  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });

  return getCurrentPosition;
}

const reading = (accuracy = 20) => ({ coords: { latitude: 54, longitude: 18, accuracy } });

beforeEach(() => {
  store.values = [];
  store.cursor = 0;
  store.supported = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SavedCollectionsList", () => {
  it("shows every card with its progress, and no mark and no reading of the position before a click", () => {
    const getCurrentPosition = stubGeolocation((success) => success(reading()));
    const markup = html();

    expect(markup).toContain('href="/collections/nowa-blisko"');
    expect(markup).toContain('href="/collections/ogolnopolska"');
    expect(markup).toMatch(/<button [^>]*>Pokaż nowe w okolicy<\/button>/);
    expect(markup).not.toContain("Nowa w okolicy");
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("marks only the collection that is both new and near, after a click", () => {
    const getCurrentPosition = stubGeolocation((success) => success(reading()));

    click();

    const markup = html();

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 600_000,
    });
    expect(markup.match(/Nowa w okolicy/g)).toHaveLength(1);
    expect(markup).toContain("Jedna z Twoich kolekcji jest nowa w okolicy.");
    expect(markup).toContain("Sprawdź ponownie");
    // All four cards stay; the position is kept nowhere in the markup.
    expect(markup.match(/href="\/collections\//g)).toHaveLength(4);
    expect(markup).not.toMatch(/54\.0|18\.0/);
  });

  it("says when nothing is new nearby, and notes a coarse reading", () => {
    stubGeolocation((success) =>
      success({ coords: { latitude: 0, longitude: 0, accuracy: 9000 } }),
    );
    click();

    const markup = html();

    expect(markup).not.toContain("Nowa w okolicy</span>");
    expect(markup).toContain("Żadna z Twoich kolekcji nie jest nowa w okolicy.");
    expect(markup).toContain("Lokalizacja jest niedokładna");
  });

  it("counts several new collections", () => {
    const many = [item("a"), item("b")];

    stubGeolocation((success) => success(reading()));
    store.cursor = 0;
    findButton(
      SavedCollectionsList({ items: many, offerNearby: true }) as ReactElement,
    )?.props.onClick?.();
    store.cursor = 0;

    expect(
      renderToStaticMarkup(
        SavedCollectionsList({ items: many, offerNearby: true }) as ReactElement,
      ),
    ).toContain("Nowe w okolicy kolekcje: 2.");
  });

  it.each([
    [1, "Nie mamy dostępu do lokalizacji. Możesz włączyć go w ustawieniach przeglądarki."],
    [2, "Nie udało się ustalić Twojego położenia. Spróbuj ponownie."],
    [3, "Ustalanie położenia trwało zbyt długo. Spróbuj ponownie."],
  ])("explains a failure (code %s) and keeps the list", (code, text) => {
    stubGeolocation((_success, fail) => fail({ code }));
    click();

    const markup = html();

    expect(markup).toContain(`<p role="status">${text}</p>`);
    expect(markup).toContain('href="/collections/nowa-blisko"');
  });

  it("gives up after its own time limit and ignores a late answer", () => {
    vi.useFakeTimers();

    try {
      let late: (p: unknown) => void = () => undefined;
      const getCurrentPosition = stubGeolocation((success) => {
        late = success;
      });

      click();
      expect(html()).toContain("Ustalam Twoje położenie…");
      click();
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(12_000);
      expect(html()).toContain("Ustalanie położenia trwało zbyt długo");
      late(reading());
      expect(html()).not.toContain("Nowa w okolicy</span>");
      click();
      expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no button when the public list could not be read or the browser has no geolocation", () => {
    expect(html(false)).not.toContain("<button");
    expect(html(false)).toContain('href="/collections/nowa-blisko"');

    store.supported = false;
    expect(html()).not.toContain("<button");
  });
});
