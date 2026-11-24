import { describe, expect, it, vi } from "vitest";

// Static tab titles "{page} — Krajozbiór" (WCAG 2.4.2). Pages with a role-dependent
// title are covered next to their page tests.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// next/font/local works only inside the Next.js compiler.
vi.mock("@/app/fonts", () => ({
  geist: { variable: "" },
  geistMono: { variable: "" },
  instrumentSerif: { variable: "" },
}));
// The shell role (identity, database driver, session library) is a cold import
// and has nothing to do with the title.
vi.mock("@/app/shell/shell-account", () => ({
  shellAccount: async () => ({ role: null, displayName: null, curatorOrganizations: [] }),
}));
vi.mock("@/app/shell/terms-state", () => ({ shellTermsAccepted: async () => true }));
vi.mock("@/app/request-actor", () => ({
  getRequestActor: async () => null,
  loginHref: () => "/login",
  signupHref: () => "/login/zaloz-konto",
}));

vi.mock("@/app/request-organizations", () => ({ getApprovedOrganizations: async () => [] }));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({ getCatalogDeps: () => ({}) }));

describe("tab titles", () => {
  it.each([
    ["@/app/layout", "Krajozbiór"],
    ["@/app/not-found", "Nie znaleziono — Krajozbiór"],
    ["@/app/regulamin/page", "Regulamin — Krajozbiór"],
    ["@/app/polityka-prywatnosci/page", "Polityka prywatności — Krajozbiór"],
    ["@/app/zasady/page", "Najważniejsze zasady — Krajozbiór"],
    ["@/app/oswiadczenie-o-zdjeciach/page", "Oświadczenie o zdjęciach — Krajozbiór"],
    ["@/app/my/page", "Profil — Krajozbiór"],
    ["@/app/curator/page", "Panel kuratora — Krajozbiór"],
    ["@/app/curator/collections/new/page", "Nowa kolekcja — Krajozbiór"],
    ["@/app/curator/collections/[collectionId]/page", "Edycja kolekcji — Krajozbiór"],
    ["@/app/curator/collections/[collectionId]/places/new/page", "Nowe miejsce — Krajozbiór"],
    [
      "@/app/curator/collections/[collectionId]/places/[placeId]/page",
      "Edycja miejsca — Krajozbiór",
    ],
  ])(
    "%s has the title „%s”",
    async (path, title) => {
      const { metadata } = (await import(/* @vite-ignore */ path)) as {
        metadata: { title: string };
      };

      expect(metadata.title).toBe(title);
    },
    // Each case is a cold dynamic import of a whole page; under load (parallel tests or a
    // build) it can take far longer than on an idle machine. Test timeout for tests that
    // start heavy imports is 30 s (docs/testing.md).
    30_000,
  );
});
