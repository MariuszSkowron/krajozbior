import type { Actor } from "./actor";

export type Credentials = { email: string; password: string };

export type CodeCredentials = { email: string; code: string };

export type SignInResult = { actor: Actor; setCookies: string[] };

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
}
