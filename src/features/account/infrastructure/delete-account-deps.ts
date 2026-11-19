import "server-only";

import { getIdentityProvider } from "@/features/identity/infrastructure";
import { withUserContext } from "@/lib/db/user-context";

import type { DeleteAccountDeps } from "../application/delete-account-types";

// The real dependencies of `deleteOwnAccount`. "Am I the only member" asks the
// database function of Migration20261118140000_account_deletion: through row
// security krajozbior_app sees only its own memberships and could not count the
// others itself.
export function getDeleteAccountDeps(): DeleteAccountDeps {
  return {
    withUserContext,
    async isSoleOrganizationMember(tx) {
      const row = await tx.em.execute<{ sole: boolean }>(
        `select public.app_is_sole_organization_member() as sole`,
        [],
        "get",
      );

      return row.sole;
    },
    async deleteAccount(accountId) {
      await getIdentityProvider().deleteAccount(accountId);
    },
    now: () => new Date(),
  };
}
