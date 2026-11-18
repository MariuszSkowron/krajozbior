import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in unit tests: `useState` is replaced by a small store that survives
// repeated calls of the component function, so one "render" is one call.
const store = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refresh: vi.fn() }));

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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: store.refresh }) }));

const { SaveCollectionButton } = await import("@/app/collections/[slug]/save-collection-button");

type Node = { props: { children?: unknown; onClick?: () => void; role?: string } };

function render(initialSaved: boolean) {
  store.cursor = 0;

  const root = SaveCollectionButton({ collectionId: "c1", initialSaved }) as ReactElement<{
    children: Node[];
  }>;
  const [button, status] = root.props.children;

  return { button, status: String(status.props.children) };
}

async function click() {
  render(true).button.props.onClick?.();
  // The handler is async (fetch): let it settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  store.values = [];
  store.cursor = 0;
  store.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

describe("SaveCollectionButton", () => {
  it("announces the removal to screen readers after unsaving, and the save after saving", async () => {
    expect(render(true).status).toBe("Ta kolekcja jest w Twoich zapisanych.");

    await click();
    expect(fetch).toHaveBeenLastCalledWith("/api/me/saved-collections/c1", { method: "DELETE" });
    expect(render(true).status).toBe("Usunięto z zapisanych.");
    expect(store.refresh).toHaveBeenCalledTimes(1);

    await click();
    expect(fetch).toHaveBeenLastCalledWith("/api/me/saved-collections/c1", { method: "PUT" });
    expect(render(true).status).toBe("Ta kolekcja jest w Twoich zapisanych.");
  });

  it("keeps a failed removal as an error, not as an announcement of success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    await click();
    expect(render(true).status).toBe("Za dużo prób. Spróbuj za chwilę.");
  });
});
