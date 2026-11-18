import { describe, expect, it, vi } from "vitest";

import { AuthenticationRequiredError } from "@/features/identity/domain/actor";
import {
  listMyOrganizations,
  type ListMyOrganizationsDeps,
  type MyOrganization,
} from "@/features/organizations/application/list-my-organizations";

const organization: MyOrganization = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Gmina A",
  slug: "gmina-a",
  kind: "municipality",
  status: "suspended",
};

function deps(): ListMyOrganizationsDeps {
  return {
    withUserContext: vi.fn(async (_actor, work) => work({ em: {} as never })),
    listMemberships: vi.fn(async () => [organization]),
  };
}

describe("listMyOrganizations", () => {
  it("returns unauthenticated for a guest and does not open a context", async () => {
    const target = deps();

    expect(await listMyOrganizations(null, target)).toEqual({ status: "unauthenticated" });
    expect(target.withUserContext).not.toHaveBeenCalled();
  });

  it("lists the organizations of the actor with their status", async () => {
    const target = deps();
    const actor = { id: "00000000-0000-4000-8000-000000000002", role: "user" } as const;

    expect(await listMyOrganizations(actor, target)).toEqual({
      status: "ok",
      organizations: [organization],
    });
    expect(target.withUserContext).toHaveBeenCalledWith(actor, target.listMemberships);
  });

  it("does not swallow other errors", async () => {
    const failure = new Error("db down");
    const target = {
      ...deps(),
      withUserContext: vi.fn(async () => {
        throw failure;
      }),
    };

    await expect(listMyOrganizations({ id: "x", role: "user" }, target)).rejects.toBe(failure);
    expect(new AuthenticationRequiredError()).toBeInstanceOf(Error);
  });
});
