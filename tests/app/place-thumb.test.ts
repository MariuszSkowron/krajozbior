import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in unit tests: `useState` is replaced by a small store that survives
// repeated calls of the component function, so one "render" is one call.
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
}));

const { PlaceThumb } = await import("@/app/collections/[slug]/place-thumb");

const thumb = { photoId: "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b", width: 1280, height: 853 };

type Box = { props: { children: ReactElement<{ src: string; alt: string; onError: () => void }> } };

function render(value: typeof thumb | null) {
  store.cursor = 0;

  return PlaceThumb({ thumb: value }) as unknown as Box | null;
}

describe("PlaceThumb", () => {
  beforeEach(() => {
    store.values = [];
  });

  it("renders nothing for a place without a photo", () => {
    expect(render(null)).toBeNull();
  });

  it("renders the decorative image of the photo", () => {
    const image = render(thumb)?.props.children;

    expect(image?.props.src).toBe(`/media/p/${thumb.photoId}/w400`);
    expect(image?.props.alt).toBe("");
  });

  it("disappears when the file does not load, so no broken image icon is shown", () => {
    render(thumb)?.props.children.props.onError();

    expect(render(thumb)).toBeNull();
  });
});
