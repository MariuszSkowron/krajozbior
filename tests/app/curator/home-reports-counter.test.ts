import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurator: vi.fn(),
  listCollections: vi.fn(),
  countOpenReports: vi.fn(),
}));

vi.mock("next/link", async () => {
  const { createElement } = await import("react");

  return {
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      createElement("a", { href, ...rest }, children),
  };
});
vi.mock("@/app/curator/curator-session", async () => {
  const actual = await vi.importActual<typeof import("@/app/curator/curator-session")>(
    "@/app/curator/curator-session",
  );

  return { ...actual, requireCurator: mocks.requireCurator };
});
vi.mock("@/features/catalog/application/curator-queries", () => ({
  listCuratorCollections: mocks.listCollections,
}));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({ getCatalogDeps: () => ({}) }));
vi.mock("@/features/reports/application/curator-reports", () => ({
  countOpenReports: mocks.countOpenReports,
}));
vi.mock("@/features/reports/infrastructure/reports-deps", () => ({ getReportsDeps: () => ({}) }));

const { default: CuratorHome } = await import("@/app/curator/page");

const organization = { id: "11111111-1111-4111-8111-111111111111", name: "Gmina A" };
const collection = {
  id: "c1",
  title: "Mosty i zamki",
  status: "published",
  region: "pomorskie",
  placeCount: 3,
  updatedAt: new Date("2026-11-20T10:00:00Z"),
};

async function render(): Promise<string> {
  return renderToStaticMarkup(await CuratorHome({ searchParams: Promise.resolve({}) }));
}

describe("the counter of waiting reports on the panel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.requireCurator.mockResolvedValue({ actor: { id: "a" }, organizations: [organization] });
    mocks.listCollections.mockResolvedValue({ status: "ok", value: [collection] });
  });

  it("shows the count with a link to the queue", async () => {
    mocks.countOpenReports.mockResolvedValue({ status: "ok", value: 2 });

    const html = await render();

    expect(html).toContain("Zgłoszenia do sprawdzenia: 2");
    expect(html).toContain("Mosty i zamki");
  });

  it("keeps the collections and says so in its own section when the count fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mocks.countOpenReports.mockRejectedValue(new Error("relation does not exist"));

    const html = await render();

    expect(html).toContain("Mosty i zamki");
    expect(html).toContain("Wymaga uwagi");
    expect(html).toContain("Nie udało się sprawdzić zgłoszeń.");
    expect(html).not.toContain("Zgłoszenia do sprawdzenia");
    // only the class of the error is logged, never its message
    expect(logged).toHaveBeenCalledWith("Open reports count failed:", "Error");
  });

  it("leaves the section out when the answer is not a count", async () => {
    mocks.countOpenReports.mockResolvedValue({ status: "forbidden" });

    const html = await render();

    expect(html).toContain("Mosty i zamki");
    expect(html).not.toContain("Wymaga uwagi");
  });
});
