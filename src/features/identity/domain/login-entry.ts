// Two entrances to one e-mail code mechanism: "Zaloguj się" (`login`) and "Załóż konto"
// (`signup`). The mechanism, the limits and the account creation are the same; the entrance only
// chooses the headings, the texts and the page the forms return to. The signup page lives under
// /login so that the short-lived address cookie (Path=/login) reaches both steps.
import { safeReturnTo } from "./return-to";

export type LoginEntry = "login" | "signup";

export const LOGIN_PATH = "/login";
export const SIGNUP_PATH = "/login/zaloz-konto";

// Query parameter that carries the entrance to the "Zanim zaczniesz" screen after a sign-in
// that created the account (the screen then explains it). Never reveals anything before the
// code was accepted.
export const FIRST_SIGN_IN_PARAM = "wejscie";
export const FIRST_SIGN_IN_FROM_LOGIN = "logowanie";
// The same parameter after "Załóż konto" for an address that already had an account: the start
// page then says so (after the code, so nothing is revealed before it).
export const FIRST_SIGN_IN_EXISTING_ACCOUNT = "istnieje";

/** The calm message after "Załóż konto" for an address that already had an account. */
export const EXISTING_ACCOUNT_NOTICE = "Masz już konto z tym adresem — zalogowaliśmy Cię.";

/** Only the exact value `signup` selects the signup entrance; anything else is the login. */
export function loginEntry(value: unknown): LoginEntry {
  return value === "signup" ? "signup" : "login";
}

/** The page of the entrance, with the destination to return to after signing in. */
export function entryPath(entry: LoginEntry, returnTo: string | null = null): string {
  const path = entry === "signup" ? SIGNUP_PATH : LOGIN_PATH;

  return returnTo === null ? path : `${path}?${new URLSearchParams({ returnTo })}`;
}

/** The destination with the mark that the account was created by the "Zaloguj się" entrance. */
export function withFirstSignInNotice(
  destination: string,
  mark: string = FIRST_SIGN_IN_FROM_LOGIN,
): string {
  const url = new URL(destination, "http://destination.invalid");

  url.searchParams.set(FIRST_SIGN_IN_PARAM, mark);

  return safeReturnTo(`${url.pathname}${url.search}${url.hash}`);
}
