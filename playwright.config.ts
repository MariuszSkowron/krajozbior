import { defineConfig, devices } from "@playwright/test";

// Port 3000 is the default; locally it is often taken by a dev server, which
// reuseExistingServer would silently test instead. Use E2E_PORT=3100 there.
// The port goes into the server's shell command, so only digits are accepted.
const port = process.env.E2E_PORT ?? "3000";
if (!/^\d{1,5}$/.test(port)) {
  throw new Error("E2E_PORT must be a port number");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // The seeded demo accounts accept the terms before the run (F-K3).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      PORT: port,
      HOSTNAME: "127.0.0.1",
      // Test-only fallbacks: a throwaway session secret, not a credential. The
      // login specs also need a migrated, seeded database reached as krajozbior_app
      // and krajozbior_auth (see e2e/login.spec.ts); without one they are skipped.
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgres://krajozbior:krajozbior@127.0.0.1:5432/krajozbior",
      DATABASE_AUTH_URL:
        process.env.DATABASE_AUTH_URL ??
        "postgres://krajozbior:krajozbior@127.0.0.1:5432/krajozbior",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-0123456789abcdef-xyz",
      // A production build requires the public address; plain http is accepted
      // only for this loopback host.
      BETTER_AUTH_URL: baseURL,
      // Sign-in codes go to a local outbox; a production build accepts it only
      // with the test flag and a loopback BETTER_AUTH_URL.
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_DIR: ".data/e2e-email-outbox",
      EMAIL_OUTBOX_TEST_ONLY: "1",
      // A production build has no default sender address (parseEmailEnv).
      EMAIL_FROM: "noreply@krajozbior.local",
      // Photo files of the E2E specs: e2e/commons-photos.spec.ts writes them here (E4-2b).
      MEDIA_ROOT: ".data/e2e-media",
      // The seeded demo accounts sign in to a production build only with this
      // test flag and a loopback BETTER_AUTH_URL (isDemoSignInAllowed).
      DEMO_ACCOUNTS_TEST_ONLY: "1",
      // Reports of a problem with a place (P4b) are off by default; the specs need them on.
      FEATURE_PLACE_REPORTS: "true",
      // No memory of "Miejsce dnia": specs delete the places they seed.
      PLACE_OF_DAY_CACHE_TTL_MS: "0",
    },
  },
});
