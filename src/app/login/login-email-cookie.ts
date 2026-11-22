import { z } from "zod";

// The address typed in step 1 of the e-mail sign-in, kept between the two steps so the person
// enters it once (D-49). It is personal data, so it never goes into the URL or a log: a short
// lived cookie that JavaScript cannot read, sent only to the login page (Path=/login), over
// HTTPS in production. It is removed on a successful sign-in and by "Zmień adres".
export const LOGIN_EMAIL_COOKIE = "krajozbior_login_email";
export const LOGIN_EMAIL_PATH = "/login";
export const LOGIN_EMAIL_MAX_AGE_SECONDS = 10 * 60;

const emailSchema = z.email().max(254);

/** The address from the cookie value, or null when it is missing or malformed. */
export function loginEmailFromCookie(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const parsed = emailSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function attributes(maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `Path=${LOGIN_EMAIL_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function loginEmailSetCookieHeader(email: string): string {
  return `${LOGIN_EMAIL_COOKIE}=${encodeURIComponent(email)}; ${attributes(LOGIN_EMAIL_MAX_AGE_SECONDS)}`;
}

export function loginEmailClearCookieHeader(): string {
  return `${LOGIN_EMAIL_COOKIE}=; ${attributes(0)}`;
}

/** "anna@example.com" becomes "a…@example.com": enough to recognise it, not to read it out. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");

  if (at < 1) {
    return email;
  }

  const [first = ""] = Array.from(email.slice(0, at));

  return `${first}…${email.slice(at)}`;
}
