import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in unit tests: `useState` and `useRef` are replaced by a small store
// that survives repeated calls of the component function.
const store = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  refs: [] as { current: unknown }[],
  refCursor: 0,
  effects: [] as (() => void)[],
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
    const index = store.refCursor++;

    store.refs[index] ??= { current: initial };

    return store.refs[index];
  },
  // The effects are collected, not run: a test runs them by hand.
  useEffect: (effect: () => void) => {
    store.effects.push(effect);
  },
}));

const { VisitConfirmation } = await import("@/app/places/[placeId]/visit-confirmation");

type Node = {
  props: {
    children?: unknown;
    role?: string;
    tabIndex?: number;
    ref?: (element: { focus: () => void } | null) => void;
  };
};

beforeEach(() => {
  store.values = [];
  store.cursor = 0;
  store.refs = [];
  store.refCursor = 0;
  store.effects = [];
});

describe("VisitConfirmation after a saved visit", () => {
  it("moves the focus to the success message, which is a live status region", () => {
    store.values = [{ kind: "recorded", collections: [] }];

    const root = VisitConfirmation({ placeId: "p1", initialWanted: false }) as ReactElement<{
      children: Node[];
    }>;
    const message = (root.props.children as unknown as Node[])[0]!;
    let focused = 0;

    expect(message.props.role).toBe("status");
    expect(message.props.tabIndex).toBe(-1);
    message.props.ref?.({ focus: () => (focused += 1) });
    expect(focused).toBe(1);
    // A detached element (unmount) must not throw.
    expect(() => message.props.ref?.(null)).not.toThrow();
  });

  it("keeps the focus on the button before the visit is saved", () => {
    store.values = [{ kind: "idle" }];

    const root = VisitConfirmation({ placeId: "p1", initialWanted: false }) as ReactElement<{
      children: Node[];
    }>;
    const children = root.props.children as unknown as Node[];

    // Only the success message takes the focus (tabIndex -1); the feedback paragraph has a ref
    // for scrolling but is not focusable.
    expect(children.some((child) => child?.props?.tabIndex !== undefined)).toBe(false);
  });
});

// The text and the props of the elements of the returned tree, without rendering the
// child components (their hooks are not part of what is checked here).
type Tree = { type?: unknown; props?: { children?: unknown; className?: string } };

function flatten(node: unknown): Tree[] {
  if (Array.isArray(node)) {
    return node.flatMap(flatten);
  }

  if (typeof node !== "object" || node === null) {
    return [];
  }

  return [node as Tree, ...flatten((node as Tree).props?.children)];
}

function textOf(node: unknown): string {
  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }

  if (typeof node === "string") {
    return node;
  }

  return typeof node === "object" && node !== null ? textOf((node as Tree).props?.children) : "";
}

function buttonOf(root: unknown): Tree {
  return flatten(root).find((element) => element.type === "button")!;
}

describe("VisitConfirmation texts (D-49)", () => {
  it("first person on the primary button, 'Potwierdzam wizytę'", () => {
    store.values = [{ kind: "idle" }];

    const button = buttonOf(VisitConfirmation({ placeId: "p1", initialWanted: false }));

    expect(textOf(button)).toBe("Potwierdzam wizytę");
    expect(button.props?.className).toContain("button--primary");
  });

  it("after a visit from the past: state on top and a secondary button 'na miejscu'", () => {
    store.values = [{ kind: "idle" }];

    const root = VisitConfirmation({
      placeId: "p1",
      initialWanted: false,
      past: "Z przeszłości · 2018",
    });
    const button = buttonOf(root);

    expect(textOf(root)).toContain("Wizyta z przeszłości zapisana");
    expect(textOf(button)).toBe("Potwierdzam wizytę na miejscu");
    expect(button.props?.className).toContain("button--outline");
    expect(button.props?.className).not.toContain("button--primary");
  });

  it("says how close to come when the place is too far", () => {
    store.values = [{ kind: "out_of_range", distanceM: 6200 }];

    const root = VisitConfirmation({ placeId: "p1", initialWanted: false, radiusM: 150 });

    expect(textOf(root)).toContain(
      "Jesteś 6,2 km od miejsca. Wizytę potwierdzisz w promieniu 150 m od niego.",
    );
  });

  it("keeps the message about location out of the pinned bar", () => {
    store.values = [{ kind: "out_of_range", distanceM: 6200 }];

    const root = VisitConfirmation({ placeId: "p1", initialWanted: false, radiusM: 150 });
    const dock = flatten(root).find(
      (element) => (element.type as { name?: string })?.name === "PinnedAction",
    );

    expect(textOf(dock)).toBe("Sprawdź ponownie");
  });

  it("gives the radius in kilometres when it is 1000 m or more", () => {
    store.values = [{ kind: "out_of_range", distanceM: 6200 }];

    expect(
      textOf(VisitConfirmation({ placeId: "p1", initialWanted: false, radiusM: 1500 })),
    ).toContain("w promieniu 1,5 km od niego.");

    store.cursor = 0;
    store.refCursor = 0;

    expect(
      textOf(VisitConfirmation({ placeId: "p1", initialWanted: false, radiusM: 1000 })),
    ).toContain("w promieniu 1 km od niego.");
  });
});

describe("VisitConfirmation scrolls the result into view (the button is in the pinned bar)", () => {
  function scrolls(kind: Record<string, unknown>, reduced: boolean) {
    store.values = [kind];
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });

    const calls: unknown[] = [];

    VisitConfirmation({ placeId: "p1", initialWanted: false });
    store.refs[1]!.current = { scrollIntoView: (options: unknown) => calls.push(options) };
    store.effects.forEach((effect) => effect());
    vi.unstubAllGlobals();

    return calls;
  }

  it.each([
    { kind: "out_of_range", distanceM: 900 },
    { kind: "inaccurate", accuracyM: 500 },
    { kind: "problem", problem: "denied" },
    { kind: "failed", message: "Brak połączenia.", canRetry: true },
  ])("after the state $kind", (state) => {
    expect(scrolls(state, false)).toEqual([{ block: "nearest", behavior: "smooth" }]);
  });

  it("does not animate when the person limits motion", () => {
    expect(scrolls({ kind: "out_of_range", distanceM: 900 }, true)).toEqual([
      { block: "nearest", behavior: "auto" },
    ]);
  });

  it.each([{ kind: "idle" }, { kind: "locating" }, { kind: "sending" }])(
    "does not scroll in the state $kind",
    (state) => {
      expect(scrolls(state, false)).toEqual([]);
    },
  );
});
