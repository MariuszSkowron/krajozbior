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

    const root = VisitConfirmation({ placeId: "p1" }) as ReactElement<{ children: Node[] }>;
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

    const root = VisitConfirmation({ placeId: "p1" }) as ReactElement<{ children: Node[] }>;
    const children = root.props.children as unknown as Node[];

    expect(children.some((child) => child?.props?.ref !== undefined)).toBe(false);
  });
});
