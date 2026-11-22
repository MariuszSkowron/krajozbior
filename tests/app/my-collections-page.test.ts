import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), saved: vi.fn(), own: vi.fn() }));

vi.mock("@/app/request-actor", () => ({
  logReadFailure: vi.fn(),
  getRequestActor: mocks.actor,
  loginHref: (path: string) => `/login?returnTo=${encodeURIComponent(path)}`,
}));
vi.mock("@/features/album/application/saved-collections", () => ({
  listMyCollectionsWithProgress: mocks.saved,
}));
vi.mock("@/features/album/infrastructure/album-deps", () => ({ getAlbumDeps: () => ({}) }));
vi.mock("@/features/own-collections/application/own-collections", () => ({
  listOwnCollections: mocks.own,
}));
vi.mock("@/features/own-collections/infrastructure/own-collections-deps", () => ({
  getOwnCollectionsDeps: () => ({}),
}));

const page = await import("@/app/my/collections/page");
const loading = await import("@/app/my/collections/loading");

const summary = (slug: string, visited: number, total: number) => ({
  id: slug,
  slug,
  title: `Kolekcja ${slug}`,
  region: "pomorskie",
  progress: { kind: "progress", visited, total },
});

async function render(stan?: string) {
  return renderToStaticMarkup(
    await page.default({ searchParams: Promise.resolve(stan === undefined ? {} : { stan }) }),
  );
}

beforeEach(() => {
  mocks.actor.mockReset().mockResolvedValue({ id: "u1", role: "user" });
  mocks.own.mockReset().mockResolvedValue({ status: "ok", value: [] });
  mocks.saved.mockReset().mockResolvedValue({
    status: "ok",
    value: [summary("a", 0, 3), summary("b", 1, 3), summary("c", 3, 3)],
  });
});

describe("Moje kolekcje", () => {
  it("filters by the state with plain links (no form, no 'Pokaż' button, no 'nowe w okolicy')", async () => {
    const markup = await render();

    expect(markup).toContain("Zapisane kolekcje i Twój postęp w nich.");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("Pokaż</button>");
    expect(markup).not.toContain("w okolicy");
    expect(markup).toContain('href="/my/collections"');
    expect(markup).toContain('href="/my/collections?stan=w-trakcie"');
    expect(markup).toContain('href="/my/collections?stan=nierozpoczete"');
    expect(markup).toContain('href="/my/collections?stan=ukonczone"');
    expect(markup).toMatch(/aria-current="page"[^>]*>Wszystkie <span[^>]*>\(3\)/);
    expect(markup).toMatch(/>W trakcie <span[^>]*>\(1\)/);
    expect(markup.match(/href="\/collections\//g)).toHaveLength(3);
  });

  it("shows only the matching collections and marks the chosen state", async () => {
    const markup = await render("w-trakcie");

    expect(markup).toMatch(/aria-current="page"[^>]*>W trakcie <span/);
    expect(markup).toContain("Zapisane kolekcje (1 z 3)");
    expect(markup.match(/href="\/collections\//g)).toHaveLength(1);
    expect(markup).toContain('href="/collections/b"');
  });

  it("explains an empty state in plain words", async () => {
    mocks.saved.mockResolvedValue({ status: "ok", value: [summary("a", 0, 3)] });

    const markup = await render("ukonczone");

    expect(markup).toContain("Żadna zapisana kolekcja nie jest w stanie „Ukończone”.");
    expect(markup).toContain('href="/my/collections">Pokaż wszystkie</a>');
  });

  it("says 'Zobacz kolekcje' when nothing is saved", async () => {
    mocks.saved.mockResolvedValue({ status: "ok", value: [] });

    const markup = await render();

    expect(markup).toContain("Zobacz kolekcje");
    expect(markup).not.toContain("Przejdź do katalogu");
  });

  it("shows a skeleton while loading, with the status text for screen readers only", () => {
    const markup = renderToStaticMarkup(loading.default());

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Wczytuję Twoje kolekcje…");
    expect(markup.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
