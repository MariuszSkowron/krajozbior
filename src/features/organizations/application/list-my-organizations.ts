import {
  requireActor,
  AuthenticationRequiredError,
  type Actor,
} from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import type { OrganizationKind, OrganizationStatus } from "../domain/organization";

// Organizations of the signed-in account with the status of each (E1). The
// shell uses it in PR3 to decide whether to show the curator panel link (only
// an `approved` organization); this is a choice of link, not access control:
// the database decides what a member may do (app_org_permission).

export type MyOrganization = Readonly<{
  id: string;
  name: string;
  slug: string;
  kind: OrganizationKind;
  status: OrganizationStatus;
}>;

export type ListMyOrganizationsResult =
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "ok"; organizations: readonly MyOrganization[] }>;

export type ListMyOrganizationsDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  listMemberships: (tx: TransactionContext) => Promise<readonly MyOrganization[]>;
}>;

// The owner is always the actor from the session: no user or organization id
// comes from the caller.
export async function listMyOrganizations(
  actor: Actor | null,
  deps: ListMyOrganizationsDeps,
): Promise<ListMyOrganizationsResult> {
  let signedIn: Actor;

  try {
    signedIn = requireActor(actor);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { status: "unauthenticated" };
    }
    throw error;
  }

  const organizations = await deps.withUserContext(signedIn, deps.listMemberships);

  return { status: "ok", organizations };
}
