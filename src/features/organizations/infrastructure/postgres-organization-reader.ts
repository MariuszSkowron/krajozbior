import "server-only";

import type { TransactionContext } from "@/lib/db/user-context";
import { withUserContext } from "@/lib/db/user-context";

import type { ListMyOrganizationsDeps, MyOrganization } from "../application/list-my-organizations";

// Reads inside the user context: the policies of organization_members show only
// the actor's own rows, so the join cannot reach another account's membership.
export async function listMemberOrganizations(
  tx: TransactionContext,
): Promise<readonly MyOrganization[]> {
  return tx.em.execute<MyOrganization[]>(
    `select o.id, o.name, o.slug, o.kind, o.status
       from public.organizations o
       join public.organization_members m on m.organization_id = o.id
      where m.user_id = (select app_current_user_id())
      order by o.name, o.id`,
  );
}

export const listMyOrganizationsDeps: ListMyOrganizationsDeps = {
  withUserContext,
  listMemberships: listMemberOrganizations,
};
