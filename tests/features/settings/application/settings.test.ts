import { describe, expect, it, vi } from "vitest";

import { getMyTheme, saveMyTheme } from "@/features/settings/application/settings";
import type { SettingsDeps } from "@/features/settings/application/settings-types";

const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" } as const;

function makeDeps(stored: "dark" | "light" | null = null) {
  const repository = {
    readTheme: vi.fn().mockResolvedValue(stored),
    saveTheme: vi.fn().mockResolvedValue(undefined),
  };
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: unknown) => Promise<unknown>) =>
    work({}),
  );

  return {
    repository,
    withUserContext,
    deps: { withUserContext, repository } as unknown as SettingsDeps,
  };
}

describe("getMyTheme", () => {
  it("turns a guest away before touching the database", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await getMyTheme(null, deps)).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("returns the stored theme, or null when the account never chose", async () => {
    expect(await getMyTheme(actor, makeDeps("light").deps)).toEqual({
      status: "ok",
      value: "light",
    });
    expect(await getMyTheme(actor, makeDeps(null).deps)).toEqual({ status: "ok", value: null });
  });

  it("opens the context of the actor from the session", async () => {
    const { deps, withUserContext } = makeDeps();

    await getMyTheme(actor, deps);

    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
  });
});

describe("saveMyTheme", () => {
  it("turns a guest away before touching the database", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await saveMyTheme(null, "light", deps)).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("refuses a value outside the list without a database call", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await saveMyTheme(actor, "neon", deps)).toEqual({ status: "invalid" });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("stores a known theme in the context of the actor", async () => {
    const { deps, repository } = makeDeps();

    expect(await saveMyTheme(actor, "light", deps)).toEqual({ status: "ok", value: "light" });
    expect(repository.saveTheme).toHaveBeenCalledWith(expect.anything(), "light");
  });
});
