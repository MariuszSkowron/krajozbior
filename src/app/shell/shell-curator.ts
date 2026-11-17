import { unstable_rethrow } from "next/navigation";

import { logReadFailure } from "@/app/request-actor";
import { getApprovedOrganizations } from "@/app/request-organizations";
import type { Role } from "@/features/identity/domain/actor";

/**
 * Whether the shell shows the link "Panel kuratora": a signed-in account with
 * at least one approved organization (E1). Only the choice of a link, never
 * access control. A failed lookup draws the shell without the link and logs
 * the error class, so the page still renders (like `shellRole`).
 */
export async function shellCuratorLink(role: Role | null): Promise<boolean> {
  if (role === null) {
    return false;
  }

  try {
    return (await getApprovedOrganizations()).length > 0;
  } catch (error) {
    unstable_rethrow(error);
    logReadFailure("Curator link lookup", error);
    return false;
  }
}
