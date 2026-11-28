import { describe, expect, it, vi } from "vitest";

import { declineTerms } from "@/features/terms/application/decline-terms";

const user = { id: "11111111-1111-4111-8111-111111111111", role: "user" } as const;

describe("declineTerms", () => {
  it("deletes the account of the actor and nothing else", async () => {
    const remove = vi.fn(async () => true);

    expect(await declineTerms(user, { deleteNeverAcceptedAccount: remove })).toBe("deleted");
    expect(remove).toHaveBeenCalledExactlyOnceWith(user.id);
  });

  it("keeps the account when the database refuses (an acceptance or an organization exists)", async () => {
    expect(await declineTerms(user, { deleteNeverAcceptedAccount: async () => false })).toBe(
      "kept",
    );
  });

  it("never tries to delete an administrator", async () => {
    const remove = vi.fn(async () => true);

    expect(
      await declineTerms({ id: user.id, role: "admin" }, { deleteNeverAcceptedAccount: remove }),
    ).toBe("kept");
    expect(remove).not.toHaveBeenCalled();
  });

  it("asks a guest to sign in and deletes nothing", async () => {
    const remove = vi.fn(async () => true);

    expect(await declineTerms(null, { deleteNeverAcceptedAccount: remove })).toBe(
      "unauthenticated",
    );
    expect(remove).not.toHaveBeenCalled();
  });
});
