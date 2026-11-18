import { cache } from "react";

import { getRequestActor } from "@/app/request-actor";
import {
  listMyOrganizations,
  type MyOrganization,
} from "@/features/organizations/application/list-my-organizations";
import { listMyOrganizationsDeps } from "@/features/organizations/infrastructure/postgres-organization-reader";

// Organizations of the signed-in account, once per request, shared by the shell
// (link "Panel kuratora") and the panel pages. Only an `approved` organization
// counts: a suspended one gives no panel. This chooses links and screens; the
// database still decides what a member may read or write (app_org_permission).
export const getApprovedOrganizations = cache(async (): Promise<readonly MyOrganization[]> => {
  const actor = await getRequestActor();
  const result = await listMyOrganizations(actor, listMyOrganizationsDeps);

  return result.status === "ok"
    ? result.organizations.filter((organization) => organization.status === "approved")
    : [];
});
