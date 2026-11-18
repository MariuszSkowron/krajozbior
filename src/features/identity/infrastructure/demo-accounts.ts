import "server-only";

import type { Role } from "../domain/actor";
import { DEMO_EMAIL_DOMAIN } from "../domain/demo-account-list";
import { getAuth } from "./better-auth";
import type { RoleAssigner } from "./user-role";

export const DEMO_PASSWORD_MIN_LENGTH = 12;

export type DemoAccount = { email: string; role: Role; name: string };

// Two users show that one cannot see the other's data; the admin shows the
// role check (403 for a user) and the password-only rule. All of them are in
// DEMO_EMAIL_DOMAIN, which never signs in on a production deployment.
export const demoAccounts: readonly DemoAccount[] = [
  { email: `user@${DEMO_EMAIL_DOMAIN}`, role: "user", name: "Użytkownik (demo)" },
  { email: `user2@${DEMO_EMAIL_DOMAIN}`, role: "user", name: "Użytkownik 2 (demo)" },
  { email: `admin@${DEMO_EMAIL_DOMAIN}`, role: "admin", name: "Administrator (demo)" },
];

// Demo accounts that exist in the database, for the list on /login. Returns
// email and role only; the password is never read here.
export async function findSeededDemoAccounts(): Promise<Pick<DemoAccount, "email" | "role">[]> {
  const context = await getAuth().$context;
  const found: Pick<DemoAccount, "email" | "role">[] = [];

  for (const { email, role } of demoAccounts) {
    if ((await context.internalAdapter.findUserByEmail(email)) !== null) {
      found.push({ email, role });
    }
  }

  return found;
}

// Creates a password account with the default role `user`, or resets the name,
// password and sessions of an existing one. Used by the demo seed and by
// `npm run auth:create-admin`; the role is set afterwards by a RoleAssigner
// (user-role.ts), because krajozbior_auth may not write the `role` column.
export async function ensurePasswordAccount(
  email: string,
  name: string,
  password: string,
): Promise<string> {
  const context = await getAuth().$context;
  const passwordHash = await context.password.hash(password);
  const found = await context.internalAdapter.findUserByEmail(email, { includeAccounts: true });

  if (found === null) {
    const user = await context.internalAdapter.createUser(
      { email, name, emailVerified: true },
      { method: "admin" },
    );

    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: passwordHash,
    });

    return user.id;
  }

  await context.internalAdapter.updateUser(found.user.id, { name });

  // A previous run may have stopped after creating the user but before
  // linking the credential account; repair that instead of reporting success.
  if (found.accounts.some((account) => account.providerId === "credential")) {
    await context.internalAdapter.updatePassword(found.user.id, passwordHash);
  } else {
    await context.internalAdapter.linkAccount({
      userId: found.user.id,
      providerId: "credential",
      accountId: found.user.id,
      password: passwordHash,
    });
  }

  // Also ends the sessions of an account whose role is about to change.
  await context.internalAdapter.deleteUserSessions(found.user.id);

  return found.user.id;
}

// Creates the demo accounts, or resets name, password, role and sessions of
// existing ones, so running it again is safe. Returns the accounts it prepared.
export async function seedDemoAccounts(
  password: string,
  assignRole: RoleAssigner,
): Promise<{ email: string; role: Role; id: string }[]> {
  if (password.length < DEMO_PASSWORD_MIN_LENGTH) {
    throw new Error(`Demo password must have at least ${DEMO_PASSWORD_MIN_LENGTH} characters`);
  }

  const prepared: { email: string; role: Role; id: string }[] = [];

  for (const { email, role, name } of demoAccounts) {
    const id = await ensurePasswordAccount(email, name, password);

    await assignRole(email, role);
    prepared.push({ email, role, id });
  }

  return prepared;
}
