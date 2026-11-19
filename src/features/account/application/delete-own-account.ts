import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";
import { SoleOrganizationMemberError } from "@/features/identity/domain/identity-provider";

import { isDeletionConfirmed, isSignInFresh } from "../domain/deletion";
import type { DeleteAccountDeps, DeleteAccountOutcome } from "./delete-account-types";

// Deleting one's own account (E9-5). The use case takes the actor from the
// session and never an account id: nobody can name another account. The order
// follows the spec (5.4 step 2): role and membership first (an administrator or
// the only member of an organization is refused, Q8), then the word and the age
// of the sign-in (Q7). Only then does the identity adapter delete the account;
// the audit entry is written by the database as a result (D-E9-3).
export async function deleteOwnAccount(
  actor: Actor | null,
  input: Readonly<{ confirmation: unknown; sessionCreatedAt: Date | null }>,
  deps: DeleteAccountDeps,
): Promise<DeleteAccountOutcome> {
  let signedIn: Actor;

  try {
    signedIn = requireActor(actor);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { status: "unauthenticated" };
    }
    throw error;
  }

  // The account of an administrator is removed by the operator (role set outside
  // the application, with a `set_user_role` entry).
  if (signedIn.role === "admin") {
    return { status: "managed_account" };
  }

  const soleMember = await deps.withUserContext(signedIn, (tx) =>
    deps.isSoleOrganizationMember(tx),
  );

  if (soleMember) {
    return { status: "managed_account" };
  }

  if (!isDeletionConfirmed(input.confirmation)) {
    return { status: "invalid_confirmation" };
  }

  if (!isSignInFresh(input.sessionCreatedAt, deps.now())) {
    return { status: "stale_session" };
  }

  // The check above gives an early, friendly refusal; the database trigger
  // decides atomically with the deletion (two last members deleting at once).
  try {
    await deps.deleteAccount(signedIn.id);
  } catch (error) {
    if (error instanceof SoleOrganizationMemberError) {
      return { status: "managed_account" };
    }
    throw error;
  }

  return { status: "deleted" };
}
