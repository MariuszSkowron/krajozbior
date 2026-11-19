// Values the person typed into the profile form that failed validation. They come
// back to the form after the redirect (WCAG 3.3.1: the typed data stays), but never
// through the URL (it reaches server logs and history): a short-lived cookie that is
// HttpOnly and scoped to the settings path carries them. Pure functions only.

export const PROFILE_DRAFT_COOKIE = "profile-draft";
export const PROFILE_DRAFT_MAX_AGE_SECONDS = 120;
const PROFILE_DRAFT_PATH = "/my/settings";

/** `Set-Cookie` value of the draft; max age 0 and an empty value clear it (also on sign-out and account deletion). */
export function profileDraftCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `${PROFILE_DRAFT_COOKIE}=${value}; Path=${PROFILE_DRAFT_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearedProfileDraftCookie(): string {
  return profileDraftCookie("", 0);
}

const FIELDS = ["firstName", "familyInitial", "region", "visibility"] as const;
const VALUE_MAX_LENGTH = 100;

export type ProfileDraft = Readonly<Record<(typeof FIELDS)[number], string>>;

/** Cookie value for the typed fields of a refused form post, or null when nothing is worth keeping. */
export function serializeProfileDraft(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const draft: Record<string, string> = {};

  for (const field of FIELDS) {
    const value = (body as Record<string, unknown>)[field];

    draft[field] = typeof value === "string" ? value.slice(0, VALUE_MAX_LENGTH) : "";
  }

  return encodeURIComponent(JSON.stringify(draft));
}

/** The typed fields from the cookie value; anything unexpected yields null. */
export function parseProfileDraft(value: string | undefined): ProfileDraft | null {
  if (value === undefined) {
    return null;
  }

  try {
    // The framework hands the cookie over decoded; decode once more only when it is not.
    const json = value.startsWith("%") ? decodeURIComponent(value) : value;
    const parsed: unknown = JSON.parse(json);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const draft: Record<string, string> = {};

    for (const field of FIELDS) {
      const entry = (parsed as Record<string, unknown>)[field];

      draft[field] = typeof entry === "string" ? entry.slice(0, VALUE_MAX_LENGTH) : "";
    }

    return draft as ProfileDraft;
  } catch {
    return null;
  }
}
