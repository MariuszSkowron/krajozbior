import { describe, expect, it, vi } from "vitest";

// Static tab titles "{page} — Starter" (WCAG 2.4.2). Pages with a role-dependent
// title are covered next to their page tests.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// The shell role (identity, database driver, session library) is a cold import
// and has nothing to do with the title.
vi.mock("@/app/shell/shell-role", () => ({ shellRole: async () => null }));
vi.mock("@/app/request-actor", () => ({
  getRequestActor: async () => null,
  loginHref: () => "/login",
}));

describe("tab titles", () => {
  it.each([
    ["@/app/layout", "Starter"],
    ["@/app/not-found", "Nie znaleziono — Starter"],
    ["@/app/my/page", "Moje konto — Starter"],
  ])(
    "%s has the title „%s”",
    async (path, title) => {
      const { metadata } = (await import(/* @vite-ignore */ path)) as {
        metadata: { title: string };
      };

      expect(metadata.title).toBe(title);
    },
    20_000,
  );
});
