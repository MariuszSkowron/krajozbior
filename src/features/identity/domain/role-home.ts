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
