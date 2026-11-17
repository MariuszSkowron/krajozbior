import { describe, expect, it } from "vitest";

import {
  DEMO_EMAIL_DOMAIN,
  isDemoEmail,
  shouldListDemoAccounts,
} from "@/features/identity/domain/demo-account-list";
import { isDemoSignInAllowed } from "@/lib/config/env";

describe("shouldListDemoAccounts", () => {
  it("hides the list in a production build", () => {
    expect(shouldListDemoAccounts("production")).toBe(false);
  });

  it.each(["development", "test", undefined])("shows the list for NODE_ENV=%s", (nodeEnv) => {
    expect(shouldListDemoAccounts(nodeEnv)).toBe(true);
  });
});

describe("isDemoEmail", () => {
  it.each([
    `admin@${DEMO_EMAIL_DOMAIN}`,
    ` User@${DEMO_EMAIL_DOMAIN.toUpperCase()} `,
    `x@sub.${DEMO_EMAIL_DOMAIN}`,
  ])("recognises %s", (email) => {
    expect(isDemoEmail(email)).toBe(true);
  });

  it.each(["admin@example.com", `admin@not${DEMO_EMAIL_DOMAIN}`, `${DEMO_EMAIL_DOMAIN}@x.com`])(
    "does not mistake %s for a demo account",
    (email) => {
      expect(isDemoEmail(email)).toBe(false);
    },
  );
});

describe("isDemoSignInAllowed", () => {
  it("allows the demo accounts outside production", () => {
    expect(isDemoSignInAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(isDemoSignInAllowed({})).toBe(true);
  });

  it("refuses them in production, also with a public address and the flag", () => {
    expect(isDemoSignInAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(
      isDemoSignInAllowed({
        NODE_ENV: "production",
        DEMO_ACCOUNTS_TEST_ONLY: "1",
        BETTER_AUTH_URL: "https://app.example.com",
      }),
    ).toBe(false);
  });

  it("allows them in a production build of the tests: flag and loopback address", () => {
    expect(
      isDemoSignInAllowed({
        NODE_ENV: "production",
        DEMO_ACCOUNTS_TEST_ONLY: "1",
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
      }),
    ).toBe(true);
    expect(
      isDemoSignInAllowed({ NODE_ENV: "production", BETTER_AUTH_URL: "http://127.0.0.1:3100" }),
    ).toBe(false);
  });
});
