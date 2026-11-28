import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in unit tests: hooks are replaced so the component functions can be
// called directly, and the effect of the fields is captured to run its cleanup.
const store = vi.hoisted(() => ({
  setDirty: vi.fn(),
  effects: [] as Array<() => unknown>,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => [initial, () => undefined],
  useEffect: (effect: () => unknown) => {
    store.effects.push(effect);
  },
  useContext: () => ({ dirty: false, setDirty: store.setDirty }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { CollectionForm } = await import("@/app/curator/collection-form");

const collection = { id: "c1", version: 2, title: "Zamki", summary: "Opis", region: "pomorskie" };

beforeEach(() => {
  store.setDirty.mockReset();
  store.effects = [];
});

function regionHelp(extra: { hasExtraRegions?: boolean }): unknown {
  const root = CollectionForm({
    mode: "edit",
    collection: { ...collection, ...extra },
  } as never) as ReactElement<{ children: ReactElement[] }>;
  const fields = root.props.children[1] as ReactElement<Record<string, unknown>>;
  const form = (fields.type as (props: unknown) => ReactElement<{ children: ReactElement[] }>)(
    fields.props,
  );
  const region = form.props.children.find(
    (child) => (child?.props as { label?: string } | undefined)?.label === "Województwo",
  );

  return (region?.props as { help?: unknown }).help;
}

describe("the region field of the collection form", () => {
  it("explains what happens to the Także w list only when the collection has extra regions", () => {
    expect(regionHelp({ hasExtraRegions: true })).toBe(
      "Gdy wybierzesz województwo z listy „Także w”, po zapisaniu zniknie ono z tej listy, a obecne główne na nią nie trafi.",
    );
    expect(regionHelp({ hasExtraRegions: false })).toBeUndefined();
    expect(regionHelp({})).toBeUndefined();
  });
});

describe("the fields of the collection form", () => {
  it("clear the unsaved flag when they are replaced after a save (new version)", () => {
    const root = CollectionForm({ mode: "edit", collection } as never) as ReactElement<{
      children: ReactElement[];
    }>;
    const fields = root.props.children[1] as ReactElement<Record<string, unknown>>;

    expect(fields.key).toBe("2");

    (fields.type as (props: unknown) => unknown)(fields.props);

    expect(store.effects).toHaveLength(1);
    expect(store.setDirty).not.toHaveBeenCalled();

    // The cleanup of the effect runs when the fields unmount.
    const cleanup = store.effects[0]!() as () => void;
    cleanup();

    expect(store.setDirty).toHaveBeenCalledWith(false);
  });
});
