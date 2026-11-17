// The demo account list on /login helps a reviewer pick a role. A production
// build never shows it; NODE_ENV is fixed at build time.
export function shouldListDemoAccounts(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}

// Every demo account (scripts/seed-demo-accounts.ts) lives in this domain. The
// sign-in routes refuse it in production (isDemoSignInAllowed in
// src/lib/config/env.ts), so a demo admin with the shared demo password cannot
// sign in on a real deployment even if somebody seeded it there.
export const DEMO_EMAIL_DOMAIN = "demo.starter.local";

export function isDemoEmail(email: string): boolean {
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@") + 1);

  return domain === DEMO_EMAIL_DOMAIN || domain.endsWith(`.${DEMO_EMAIL_DOMAIN}`);
}
