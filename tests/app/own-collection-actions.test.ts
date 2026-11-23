import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in unit tests: `useState` is replaced by a small store that survives repeated calls of
// the component function, `useTransition` by a spy that runs the callback and reports whether a
// refresh is still going on.
const store = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  refresh: vi.fn(),
  refreshing: false,
  startTransition: vi.fn(),
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
  useTransition: () => [
    store.refreshing,
    (callback: () => void) => {
      store.startTransition();
      callback();
    },
  ],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: store.refresh }) }));

const { AddPlaceButton } = await import("@/app/my/collections/own/own-collection-actions");

type Button = { props: { children: string; onClick: () => void; "aria-disabled": boolean } };

function render() {
  store.cursor = 0;

  const root = AddPlaceButton({
    collectionId: "c1",
    placeId: "p1",
    placeName: "Zamek",
    alreadyThere: false,
  }) as ReactElement<{ children: unknown[] }>;

  return root.props.children[0] as Button;
}

beforeEach(() => {
  store.values = [];
  store.cursor = 0;
  store.refreshing = false;
  store.refresh.mockReset();
  store.startTransition.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ added: true }) }),
  );
});

describe("AddPlaceButton", () => {
  it("renders the page again as a transition after the place is added", async () => {
    render().props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(store.startTransition).toHaveBeenCalledTimes(1);
  });

  it("stays busy while the page is rendered again, so no second click is offered", () => {
    store.refreshing = true;

    const button = render();

    expect(button.props.children).toBe("Dodawanie…");
    expect(button.props["aria-disabled"]).toBe(true);
  });
});
