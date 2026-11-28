import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P4b, PR B: the form "Zgłoś problem z miejscem" and "Moje zgłoszenia". Both are behind the switch
// FEATURE_PLACE_REPORTS (off: 404), a guest is sent to sign in and back, a member of the
// organization of the place gets the sentence about the editor, and the form says BEFORE sending
// what the curator will see (D-62 point 2).
const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  redirect: vi.fn(),
  getApprovedOrganizations: vi.fn(),
  getPublishedPlace: vi.fn(),
  listMyReports: vi.fn(),
}));

vi.mock("@/app/request-actor", () => ({
  getRequestActor: mocks.getActor,
  logReadFailure: () => undefined,
  loginHref: (path: string) => `/login?returnTo=${encodeURIComponent(path)}`,
}));
vi.mock("@/app/request-organizations", () => ({
  getApprovedOrganizations: mocks.getApprovedOrganizations,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/features/catalog/application/public-catalog", () => ({
  getPublishedPlace: mocks.getPublishedPlace,
}));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({ getCatalogDeps: () => ({}) }));
vi.mock("@/features/reports/application/explorer-reports", () => ({
  listMyReports: mocks.listMyReports,
}));
vi.mock("@/features/reports/infrastructure/reports-deps", () => ({ getReportsDeps: () => ({}) }));

const { default: ReportPlacePage } = await import("@/app/places/[placeId]/report/page");
const { default: MyReportsPage } = await import("@/app/my/reports/page");

const id = "11111111-1111-4111-8111-111111111111";
const placeId = "22222222-2222-4222-8222-222222222222";
const place = {
  id: placeId,
  name: "Most Tczewski",
  organization: { name: "Gmina Tczew", slug: "gmina-tczew" },
  collections: [{ id: "33333333-3333-4333-8333-333333333333" }],
};
const params = Promise.resolve({ placeId });

beforeEach(() => {
  vi.stubEnv("FEATURE_PLACE_REPORTS", "true");
  mocks.getActor.mockReset().mockResolvedValue({ id, role: "user" });
  mocks.redirect.mockReset();
  mocks.getApprovedOrganizations.mockReset().mockResolvedValue([]);
  mocks.getPublishedPlace.mockReset().mockResolvedValue({ status: "ok", value: place });
  mocks.listMyReports.mockReset().mockResolvedValue({ status: "ok", items: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the form of a report of a problem with a place", () => {
  it("is a 404 while the switch is off, before the session or the place is read", async () => {
    vi.stubEnv("FEATURE_PLACE_REPORTS", "false");

    await expect(ReportPlacePage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getActor).not.toHaveBeenCalled();
    expect(mocks.getPublishedPlace).not.toHaveBeenCalled();
  });

  it("sends a guest to sign in and back to the form", async () => {
    mocks.getActor.mockResolvedValue(null);

    await expect(ReportPlacePage({ params })).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/login?returnTo=${encodeURIComponent(`/places/${placeId}/report`)}`,
    );
  });

  it("is a 404 for a place that is not public", async () => {
    mocks.getPublishedPlace.mockResolvedValue({ status: "not_found" });

    await expect(ReportPlacePage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("fails loudly (the error page) when the place cannot be read", async () => {
    mocks.getPublishedPlace.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(ReportPlacePage({ params })).rejects.toThrow("Public place read failed");
  });

  it("shows the kinds of problem and says before the button what the curator sees", async () => {
    const html = renderToStaticMarkup(await ReportPlacePage({ params }));

    expect(html).toContain("Co jest nie tak z miejscem Most Tczewski?");
    expect(html).toContain("Rodzaj problemu");
    for (const label of [
      "Miejsce nie istnieje",
      "Niedostępne lub zamknięte",
      "Punkt na terenie prywatnym lub niebezpiecznym",
      "Zła lokalizacja na mapie",
      "Błąd w opisie, adresie lub dostępie",
      "Inne",
    ]) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain(
      "Kurator zobaczy Twoje imię i pierwszą literę nazwiska (np. Anna K.), bez adresu e-mail.",
    );
    // the sentence stands above the send button
    expect(html.indexOf("Kurator zobaczy Twoje imię")).toBeLessThan(
      html.indexOf("Wyślij zgłoszenie"),
    );
  });

  it("tells a member of the organization of the place to use the editor, and shows no form", async () => {
    mocks.getApprovedOrganizations.mockResolvedValue([
      { id: "org", name: "Gmina Tczew", slug: "gmina-tczew" },
    ]);

    const html = renderToStaticMarkup(await ReportPlacePage({ params }));

    expect(html).toContain("Prowadzisz to miejsce — popraw je w edytorze.");
    expect(html).toContain(`/curator/collections/${place.collections[0]!.id}/places/${placeId}`);
    expect(html).not.toContain("Wyślij zgłoszenie");
  });

  it("keeps the form for a member of another organization", async () => {
    mocks.getApprovedOrganizations.mockResolvedValue([
      { id: "org", name: "Inna", slug: "inna-gmina" },
    ]);

    expect(renderToStaticMarkup(await ReportPlacePage({ params }))).toContain("Wyślij zgłoszenie");
  });
});

describe("'Moje zgłoszenia'", () => {
  const report = {
    id: "44444444-4444-4444-8444-444444444444",
    category: "closed",
    status: "open",
    rejectReason: null,
    decisionNote: null,
    createdAt: new Date("2026-11-20T10:00:00Z"),
    decidedAt: null,
    placeId,
    placeName: "Most Tczewski",
    placeDeleted: false,
    organizationName: "Gmina Tczew",
  };

  it("is a 404 while the switch is off, before the session is read", async () => {
    vi.stubEnv("FEATURE_PLACE_REPORTS", "false");

    await expect(MyReportsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getActor).not.toHaveBeenCalled();
    expect(mocks.listMyReports).not.toHaveBeenCalled();
  });

  it("sends a guest to sign in", async () => {
    mocks.getActor.mockResolvedValue(null);

    await expect(MyReportsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fmy%2Freports");
    expect(mocks.listMyReports).not.toHaveBeenCalled();
  });

  it("sends the person to sign in when the use case says unauthenticated", async () => {
    mocks.listMyReports.mockResolvedValue({ status: "unauthenticated" });

    await expect(MyReportsPage()).rejects.toThrow("NEXT_REDIRECT");
  });

  it("fails loudly when the reports cannot be read", async () => {
    mocks.listMyReports.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(MyReportsPage()).rejects.toThrow("My reports read failed");
  });

  it("says what to do when there is nothing yet", async () => {
    const html = renderToStaticMarkup(await MyReportsPage());

    expect(html).toContain("Nie masz jeszcze zgłoszeń.");
    expect(html).toContain("Zgłoś problem z miejscem");
    // a way on: to the collections
    expect(html).toContain('href="/"');
    expect(html).toContain("Zobacz kolekcje");
  });

  it("leaves out the line of the organization when its name is not visible", async () => {
    mocks.listMyReports.mockResolvedValue({
      status: "ok",
      items: [{ ...report, organizationName: "" }],
    });

    const html = renderToStaticMarkup(await MyReportsPage());

    expect(html).toContain("Czeka na kuratora");
    expect(html).not.toContain("Zgłoszenie do:");
  });

  it("shows a waiting, an accepted and a rejected report with the reason, the note and the way to disagree", async () => {
    mocks.listMyReports.mockResolvedValue({
      status: "ok",
      items: [
        report,
        { ...report, id: "a", status: "accepted", category: "missing" },
        {
          ...report,
          id: "b",
          status: "rejected",
          category: "other",
          rejectReason: "not_accurate",
          decisionNote: "Sprawdziliśmy na miejscu.",
          placeId: null,
          placeDeleted: true,
        },
      ],
    });

    const html = renderToStaticMarkup(await MyReportsPage());

    expect(html).toContain("Czeka na kuratora");
    expect(html).toContain("Przyjęte — dziękujemy");
    expect(html).toContain("Odrzucone");
    expect(html).toContain("Powód: Nie zgadza się ze stanem na miejscu");
    expect(html).toContain("Notatka kuratora: Sprawdziliśmy na miejscu.");
    expect(html).toContain("Zgłoszenie do: Gmina Tczew");
    expect(html).toContain("Most Tczewski (miejsce usunięte)");
    expect(html).toContain("Nie zgadzasz się?");
    expect(html).toContain("mailto:reklamacje@krajozbior.pl");
    // exactly one "Nie zgadzasz się?": only the rejected one has it
    expect(html.match(/Nie zgadzasz się\?/g)).toHaveLength(1);
    // no name of a curator, no id of one
    expect(html).not.toContain("decided");
  });
});
