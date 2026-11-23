import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in unit tests: hooks are replaced by a small store that survives
// repeated calls of the component function, so one "render" is one call.
const store = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  refresh: vi.fn(),
  dirty: false,
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
  useRef: () => ({ current: null }),
  // One stand-in for every context the component reads: the unsaved-changes one
  // (dirty, setDirty) and the collection-version one (current, report).
  useContext: () => ({
    dirty: store.dirty,
    setDirty: () => undefined,
    current: 3,
    report: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: store.refresh, push: vi.fn() }),
}));

const { PublicationControls } = await import("@/app/curator/publication-controls");

type Props = Record<string, unknown> & { children?: unknown };
type Node = { type: unknown; props: Props };

function walk(node: unknown, visit: (n: Node) => void) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
  } else if (node !== null && typeof node === "object" && "props" in node) {
    visit(node as Node);
    walk((node as Node).props.children, visit);
  }
}

function render() {
  store.cursor = 0;

  const root = PublicationControls({
    collection: { id: "c1", title: "T", version: 3, status: "draft", wasPublished: false },
  }) as ReactElement;
  const found: { publish?: Node; feedback?: Node } = {};

  walk(root, (node) => {
    if (node.props.children === "Publikuj") {
      found.publish = node;
    }

    if (node.props.feedback !== undefined) {
      found.feedback = node;
    }
  });

  return found;
}

async function clickPublish() {
  (render().publish?.props.onClick as () => void)();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  store.values = [];
  store.cursor = 0;
  store.dirty = false;
  store.refresh.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
  );
});

describe("PublicationControls with unsaved text in the form", () => {
  it("does not publish, and says to save first (the page would reload and drop the text)", async () => {
    store.dirty = true;

    await clickPublish();

    expect(fetch).not.toHaveBeenCalled();
    expect(store.refresh).not.toHaveBeenCalled();
    expect(render().feedback?.props.feedback).toEqual({
      kind: "info",
      message: "Najpierw zapisz zmiany kolekcji.",
    });
  });

  it("drops the notice once the text is saved and shows it again on the next click", async () => {
    store.dirty = true;
    await clickPublish();
    expect(render().feedback?.props.feedback).not.toBeNull();
    expect(render().feedback?.props.announceKey).toBe(1);

    store.dirty = false;
    expect(render().feedback?.props.feedback).toBeNull();

    store.dirty = true;
    await clickPublish();
    expect(render().feedback?.props.feedback).toEqual({
      kind: "info",
      message: "Najpierw zapisz zmiany kolekcji.",
    });
    expect(render().feedback?.props.announceKey).toBe(2);
  });

  it("offers a way to the save button, and that moves the focus there", async () => {
    store.dirty = true;
    await clickPublish();

    const action = render().feedback?.props.action as
      { label: string; onClick: () => void } | undefined;

    expect(action?.label).toBe("Przejdź do zapisu");

    const focus = vi.fn();
    const getElementById = vi.fn().mockReturnValue({ focus });

    vi.stubGlobal("document", { getElementById });
    action?.onClick();
    vi.unstubAllGlobals();

    expect(getElementById).toHaveBeenCalledWith("collection-save");
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("publishes when everything is saved", async () => {
    await clickPublish();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.refresh).toHaveBeenCalledTimes(1);
  });
});
