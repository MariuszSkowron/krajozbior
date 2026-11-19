// Rules of deleting one's own account (E9-5, Q7): the person types the word
// and the sign-in is fresh. Pure functions; the use case and the screen share them.

export const DELETE_CONFIRMATION_WORD = "USUŃ";

// A session older than this asks for a new sign-in before the account can go
// (D-31 pt 2, Q7). Counted from the creation of the session, never from its
// last use: sessions are not refreshed (`disableSessionRefresh`).
export const FRESH_SIGN_IN_MS = 15 * 60 * 1000;

/**
 * True when the text is the confirmation word. Spaces around it and letter case
 * do not matter ("usuń" on a phone keyboard); anything else, also a missing or
 * non-text value, is not a confirmation.
 */
export function isDeletionConfirmed(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return value.normalize("NFC").trim().toLocaleUpperCase("pl-PL") === DELETE_CONFIRMATION_WORD;
}

/** True when the session was created less than FRESH_SIGN_IN_MS before `now`. A missing start is not fresh. */
export function isSignInFresh(sessionCreatedAt: Date | null, now: Date): boolean {
  if (sessionCreatedAt === null) {
    return false;
  }

  const age = now.getTime() - sessionCreatedAt.getTime();

  return age < FRESH_SIGN_IN_MS;
}
