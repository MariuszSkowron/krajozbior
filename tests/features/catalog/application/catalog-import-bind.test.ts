import { describe, expect, it, vi } from "vitest";

import {
  ActorMismatchError,
  bindDepsToTransaction,
} from "@/features/catalog/application/catalog-import";
import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import type { TransactionContext } from "@/lib/db/user-context";

const tx = { em: {} } as unknown as TransactionContext;
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const outer = vi.fn();
const deps = {
  withUserContext: outer,
  withGuestContext: outer,
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: {},
  random: () => 0,
} as unknown as CatalogDeps;

describe("bindDepsToTransaction", () => {
  it("runs the work on the open transaction for the bound actor, opening nothing new", async () => {
    const bound = bindDepsToTransaction(tx, actor, deps);
    const seen = await bound.withUserContext({ id: actor.id }, async (given) => given);

    expect(seen).toBe(tx);
    expect(outer).not.toHaveBeenCalled();
  });

  it("refuses another actor", async () => {
    const bound = bindDepsToTransaction(tx, actor, deps);
    const work = vi.fn();

    await expect(
      bound.withUserContext({ id: "22222222-2222-4222-8222-222222222222" }, work),
    ).rejects.toBeInstanceOf(ActorMismatchError);
    expect(work).not.toHaveBeenCalled();
  });

  it("has no guest context", async () => {
    const bound = bindDepsToTransaction(tx, actor, deps);

    await expect(bound.withGuestContext(async () => 1)).rejects.toThrow(/guest/);
  });
});
