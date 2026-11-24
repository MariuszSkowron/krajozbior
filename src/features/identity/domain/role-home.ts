import type { Role } from "./actor";

// Role names shown in the UI.
export const roleLabels: Record<Role, string> = {
  user: "Użytkownik",
  admin: "Administrator",
};

// Where a signed-in account lands right after signing in. A returnTo that already
// passed return-to.ts wins; otherwise a curator (an account with an approved
// organization) goes to the panel, an explorer or an administrator who has no visit and no
// saved collection yet goes to the start page (there is nothing in the account view for
// them), and everyone else to the account view. The panel still checks the membership
// itself, so this only chooses a page.
export function signInDestination({
  returnTo,
  isCurator,
  isNewExplorer = false,
}: Readonly<{
  returnTo: string | null;
  isCurator: boolean;
  isNewExplorer?: boolean;
}>): string {
  if (returnTo !== null) {
    return returnTo;
  }

  if (isCurator) {
    return "/curator";
  }

  return isNewExplorer ? "/" : "/my";
}

/** An account with no visit and no saved collection: the start page has nothing of theirs yet. */
export function isNewExplorerAccount(
  summary: Readonly<{ discoveredPlaces: number; savedCollections: number }>,
): boolean {
  return summary.discoveredPlaces === 0 && summary.savedCollections === 0;
}
