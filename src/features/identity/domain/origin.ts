// CSRF guard for cookie-authenticated state changes. A browser always sends
// Origin on cross-site POSTs; requests without it (scripts, tests) are allowed
// because they cannot ride on a victim's cookies.
export function isSameOrigin(originHeader: string | null, host: string | null): boolean {
  if (originHeader === null) {
    return true;
  }

  try {
    return host !== null && new URL(originHeader).host === host;
  } catch {
    return false;
  }
}
