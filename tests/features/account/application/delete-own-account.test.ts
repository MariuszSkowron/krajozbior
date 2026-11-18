import { describe, expect, it, vi } from "vitest";

import type { DeleteAccountDeps } from "@/features/account/application/delete-account-types";
import { deleteOwnAccount } from "@/features/account/application/delete-own-account";
import type { Actor } from "@/features/identity/domain/actor";
import { SoleOrganizationMemberError } from "@/features/identity/domain/identity-provider";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const NOW = new Date("2026-11-18T12:00:00Z");
const FRESH = new Date(NOW.getTime() - 60_000);
const STALE = new Date(NOW.getTime() - 3_600_000);

function makeDeps(soleMember = false) {
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
    work({} as never),
  );
  const isSoleOrganizationMember = vi.fn(async () => soleMember);
  const deleteAccount = vi.fn(async () => undefined);
  const deps = {
    withUserContext,
    isSoleOrganizationMember,
    deleteAccount,
    now: () => NOW,
  } as unknown as DeleteAccountDeps;

  return { deps, withUserContext, isSoleOrganizationMember, deleteAccount };
}

describe("deleteOwnAccount", () => {
  it("deletes the account of the session after the word and a fresh sign-in", async () => {
    const { deps, deleteAccount, withUserContext } = makeDeps();

    expect(
      await deleteOwnAccount(actor, { confirmation: "USUŃ", sessionCreatedAt: FRESH }, deps),
    ).toEqual({ status: "deleted" });
    expect(deleteAccount).toHaveBeenCalledWith(actor.id);
    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
  });

  it("answers unauthenticated for a guest before anything else happens", async () => {
    const { deps, deleteAccount, withUserContext } = makeDeps();

    expect(
      await deleteOwnAccount(null, { confirmation: "USUŃ", sessionCreatedAt: FRESH }, deps),
    ).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses an administrator without opening the database (Q8)", async () => {
    const { deps, deleteAccount, withUserContext } = makeDeps();

    expect(
      await deleteOwnAccount(
        { ...actor, role: "admin" },
        { confirmation: "USUŃ", sessionCreatedAt: FRESH },
        deps,
      ),
    ).toEqual({ status: "managed_account" });
    expect(withUserContext).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses the only member of an organization (Q8)", async () => {
    const { deps, deleteAccount } = makeDeps(true);

    expect(
      await deleteOwnAccount(actor, { confirmation: "USUŃ", sessionCreatedAt: FRESH }, deps),
    ).toEqual({ status: "managed_account" });
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses a wrong word", async () => {
    const { deps, deleteAccount } = makeDeps();

    expect(
      await deleteOwnAccount(actor, { confirmation: "tak", sessionCreatedAt: FRESH }, deps),
    ).toEqual({ status: "invalid_confirmation" });
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("asks for a new sign-in when the session is older than 15 minutes or has no start (Q7)", async () => {
    const { deps, deleteAccount } = makeDeps();

    for (const sessionCreatedAt of [STALE, null]) {
      expect(
        await deleteOwnAccount(actor, { confirmation: "USUŃ", sessionCreatedAt }, deps),
      ).toEqual({ status: "stale_session" });
    }
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("answers managed_account when the database refuses to leave an organization empty (race, Q8)", async () => {
    const { deps, deleteAccount } = makeDeps();

    deleteAccount.mockRejectedValue(new SoleOrganizationMemberError());

    expect(
      await deleteOwnAccount(actor, { confirmation: "USUŃ", sessionCreatedAt: FRESH }, deps),
    ).toEqual({ status: "managed_account" });
  });

  it("passes on an unexpected failure of the deletion instead of reporting success", async () => {
    const { deps, deleteAccount } = makeDeps();

    deleteAccount.mockRejectedValue(new Error("database down"));

    await expect(
      deleteOwnAccount(actor, { confirmation: "USUŃ", sessionCreatedAt: FRESH }, deps),
    ).rejects.toThrow("database down");
  });
});
