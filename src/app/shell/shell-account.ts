import { unstable_rethrow } from "next/navigation";

import { logReadFailure } from "@/app/request-actor";
import { getApprovedOrganizations } from "@/app/request-organizations";
import { getRequestProfile } from "@/app/request-profile";
import type { Role } from "@/features/identity/domain/actor";

import { shellRole } from "./shell-role";

export type ShellAccount = Readonly<{
  role: Role | null;
  /** First name from the profile, or null (no name saved, or the lookup failed). */
  displayName: string | null;
  /** Names of the approved organizations, in the order of the panel (alphabetical). */
  curatorOrganizations: readonly string[];
}>;

/**
 * What the shell header says about the account: the role, the first name of the profile and
 * the approved organizations (a curator is an account with one, not a role, paczka N).
 * Only a choice of labels and links, never access control. A failed lookup of the name or
 * of the organizations draws the header without it ("Profil", no curator label) and logs the
 * error class, so the page still renders.
 */
export async function shellAccount(): Promise<ShellAccount> {
  const role = await shellRole();

  if (role === null) {
    return { role: null, displayName: null, curatorOrganizations: [] };
  }

  let displayName: string | null = null;

  try {
    const loaded = await getRequestProfile();

    displayName = loaded.status === "ok" ? loaded.value.firstName : null;
  } catch (error) {
    unstable_rethrow(error);
    logReadFailure("Shell profile lookup", error);
  }

  let curatorOrganizations: readonly string[] = [];

  try {
    curatorOrganizations = (await getApprovedOrganizations()).map(
      (organization) => organization.name,
    );
  } catch (error) {
    unstable_rethrow(error);
    logReadFailure("Curator link lookup", error);
  }

  return { role, displayName, curatorOrganizations };
}
