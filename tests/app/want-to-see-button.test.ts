import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in unit tests: `useState` is replaced by a small store that survives
// repeated renders, so a click and the next render can be driven by hand.
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

const { WantToSeeButton } = await import("@/app/places/[placeId]/want-to-see-button");

type ButtonElement = { props: { onClick: () => void } };

const PLACE = "22222222-2222-4222-8222-222222222222";

function render(initialWanted: boolean) {
  store.cursor = 0;

  return renderToStaticMarkup(createElement(WantToSeeButton, { placeId: PLACE, initialWanted }));
}

// The click handler is the one of the button element the component returns.
async function click(initialWanted: boolean) {
  store.cursor = 0;

  const root = WantToSeeButton({ placeId: PLACE, initialWanted }) as unknown as {
    props: { children: ButtonElement[] };
  };

  root.props.children[0]!.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  store.values = [];
  store.cursor = 0;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

describe("WantToSeeButton", () => {
  it("offers the removal for a place that is on the list, also one that was visited", () => {
    const html = render(true);

    expect(html).toContain("Usuń z Chcę zobaczyć");
    expect(html).toContain("To miejsce jest na Twojej liście „Chcę zobaczyć”.");
  });

  it("removes the place with DELETE and announces it", async () => {
    await click(true);
    expect(fetch).toHaveBeenLastCalledWith(`/api/me/want-to-see/${PLACE}`, { method: "DELETE" });
    expect(render(true)).toContain("Usunięto z listy „Chcę zobaczyć”.");
    expect(render(true)).toContain(">Chcę zobaczyć<");
  });

  it("leads back to sign-in, returning to this place, when the session has expired (D2)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    await click(false);

    const html = render(false);

    expect(html).toContain("Zaloguj się ponownie, żeby zmienić listę.");
    expect(html).toContain(`href="/login?returnTo=${encodeURIComponent(`/places/${PLACE}`)}"`);
    expect(html).toContain("Zaloguj się ponownie");
  });

  it("shows no sign-in link for other failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    await click(false);

    const html = render(false);

    expect(html).toContain("Za dużo prób. Spróbuj za chwilę.");
    expect(html).not.toContain("/login");
  });

  it("tells that the list is full (409)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409 }));

    await click(false);

    expect(render(false)).toContain(
      "Na liście „Chcę zobaczyć” jest już 200 miejsc, to najwięcej. Usuń któreś, by dodać nowe.",
    );
  });
});
