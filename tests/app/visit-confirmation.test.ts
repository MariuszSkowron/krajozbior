import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in unit tests: `useState` and `useRef` are replaced by a small store
// that survives repeated calls of the component function.
const store = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));

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
  useRef: (initial: unknown) => ({ current: initial }),
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

    expect(children.some((child) => child?.props?.ref !== undefined)).toBe(false);
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
});
