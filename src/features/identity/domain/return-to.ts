const FALLBACK = "/";
const PLACEHOLDER_ORIGIN = "http://return-to.invalid";

// Accepts only a same-site path ("/x?y=1"). Anything that could leave the site
// (absolute URLs, "//host", backslashes, control characters) falls back to "/".
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return FALLBACK;
  }

  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return FALLBACK;
  }

  const parsed = new URL(value, PLACEHOLDER_ORIGIN);

  // Dot segments can turn "/..//host" into "//host", so re-check the result.
  if (parsed.pathname.startsWith("//")) {
    return FALLBACK;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

// Null when the caller asked for no destination: the role decides it after
// sign-in. A destination that was given but is unsafe still falls back to "/".
// The login page and the login route share this so "?returnTo=" means the same.
export function requestedReturnTo(value: unknown): string | null {
  return value === undefined || value === "" ? null : safeReturnTo(value);
}
