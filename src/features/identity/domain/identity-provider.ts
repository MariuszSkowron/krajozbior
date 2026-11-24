import type { Actor } from "./actor";

export type Credentials = { email: string; password: string };

export type CodeCredentials = { email: string; code: string };

export type SignInResult = {
  actor: Actor;
  setCookies: string[];
  /**
   * True when this very sign-in with a code created the account (no account with the address
   * existed just before it). Absent or false for everyone else, so nothing is explained to a
   * returning person. Only set by `signInWithCode`.
   */
  accountCreated?: boolean;
};

// Server-side boundary around the session mechanism. Domains depend on this
// contract only; the adapter in `infrastructure` knows the concrete provider.
export interface IdentityProvider {
  // Resolves the actor from the request's session cookie; null when absent,
  // expired or forged. Never trusts a role sent by the client.
  getActor(headers: Headers): Promise<Actor | null>;
  // Null for wrong credentials (the caller must not say which field was wrong).
  // Provider or database failures throw, so no partial session is reported.
  signIn(credentials: Credentials, headers: Headers): Promise<SignInResult | null>;
  // Asks for a sign-in code sent to the address. Resolves the same way whether
  // or not an account exists, so the answer reveals nothing about accounts.
  requestSignInCode(email: string, headers: Headers): Promise<void>;
  // Signs in (and on first use creates a `user` account) with a code from the
  // e-mail. Null for a wrong, expired or used-up code.
  signInWithCode(credentials: CodeCredentials, headers: Headers): Promise<SignInResult | null>;
  // Idempotent; returns Set-Cookie values that clear the session cookie.
  signOut(headers: Headers): Promise<string[]>;
  // When the request's session was created (never its last use); null without a
  // valid session. Used to ask for a fresh sign-in before account deletion.
  getSessionCreatedAt(headers: Headers): Promise<Date | null>;
  // Deletes the account in one transaction (as krajozbior_auth): sign-in codes
  // and action limits of the account, then the account row, from which the
  // database cascades to sessions and all product data and writes the audit
  // entry. Returns false when the account no longer exists. Throws
  // SoleOrganizationMemberError when the database refuses to leave an
  // organization without a member (Q8).
  deleteAccount(accountId: string): Promise<boolean>;
}

// The database refused the deletion: the account is the last member of an
// organization (trigger of Migration20261118150000_last_member_guard).
export class SoleOrganizationMemberError extends Error {
  constructor() {
    super("The account is the only member of an organization.");
    this.name = "SoleOrganizationMemberError";
  }
}
