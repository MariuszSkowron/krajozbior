import type { Role } from "./actor";

// Role names shown in the UI.
export const roleLabels: Record<Role, string> = {
  user: "Użytkownik",
  admin: "Administrator",
};

// Where a role lands after signing in without returnTo.
const roleHomes: Record<Role, string> = {
  user: "/my",
  admin: "/my",
};

export function roleHome(role: Role): string {
  return roleHomes[role];
}

// Where a signed-in account lands right after signing in. A returnTo that already
// passed return-to.ts wins; otherwise a curator (an account with an approved
// organization) goes to the panel and everyone else to the account view. The panel
// still checks the membership itself, so this only chooses a page.
export function signInDestination({
  returnTo,
  isCurator,
}: Readonly<{ returnTo: string | null; isCurator: boolean }>): string {
  if (returnTo !== null) {
    return returnTo;
  }

  return isCurator ? "/curator" : "/my";
}
