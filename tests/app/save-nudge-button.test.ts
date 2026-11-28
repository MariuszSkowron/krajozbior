import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in unit tests: `useState` is replaced by a small store, one "render" is one call.
const store = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refresh: vi.fn() }));
const hydration = vi.hoisted(() => ({ hydrated: true }));

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
}));
vi.mock("@/app/use-hydrated", () => ({ useHydrated: () => hydration.hydrated }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: store.refresh }) }));

const { SaveNudgeButton } = await import("@/app/home/save-nudge-button");

type Node = { props: { children?: unknown; disabled?: boolean; onClick?: () => void } };

function render() {
  store.cursor = 0;

  const root = SaveNudgeButton({ collectionId: "c1" }) as ReactElement<{ children: Node[] }>;
  const [button, status] = root.props.children;

  return { button, status: String(status.props.children) };
}

beforeEach(() => {
  store.values = [];
  store.cursor = 0;
  store.refresh.mockReset();
  hydration.hydrated = true;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

describe("SaveNudgeButton", () => {
  it("stays disabled until the page is hydrated, enabled afterwards", () => {
    hydration.hydrated = false;
    expect(render().button.props.disabled).toBe(true);

    hydration.hydrated = true;
    expect(render().button.props.disabled).toBe(false);
  });

  it("is labelled like the button on the collection page (D-55 pkt 3)", () => {
    expect(render().button.props.children).toBe("Zapisuję kolekcję");
  });

  it("saves the collection and refreshes the page", async () => {
    render().button.props.onClick?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenLastCalledWith("/api/me/saved-collections/c1", { method: "PUT" });
    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the error when the save fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    render().button.props.onClick?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(render().status).toBe("Za dużo prób. Spróbuj za chwilę.");
    expect(store.refresh).not.toHaveBeenCalled();
  });
});
