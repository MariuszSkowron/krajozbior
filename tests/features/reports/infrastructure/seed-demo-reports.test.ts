import { describe, expect, it } from "vitest";

import {
  assertDemoReportsAllowed,
  demoReports,
} from "@/features/reports/infrastructure/seed-demo-reports";

// The demo reports are seeded only where the demo accounts may sign in (spec N4).
describe("assertDemoReportsAllowed", () => {
  it("allows outside production", () => {
    expect(() => assertDemoReportsAllowed({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertDemoReportsAllowed({})).not.toThrow();
  });

  it("refuses in production unless it is a local test build", () => {
    expect(() => assertDemoReportsAllowed({ NODE_ENV: "production" })).toThrow(/demo accounts/);
    expect(() =>
      assertDemoReportsAllowed({
        NODE_ENV: "production",
        DEMO_ACCOUNTS_TEST_ONLY: "1",
        BETTER_AUTH_URL: "https://krajozbior.example",
      }),
    ).toThrow(/demo accounts/);
    expect(() =>
      assertDemoReportsAllowed({
        NODE_ENV: "production",
        DEMO_ACCOUNTS_TEST_ONLY: "1",
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
      }),
    ).not.toThrow();
  });

  it("brings two open reports and one rejected one", () => {
    expect(demoReports.filter((report) => report.decision === null)).toHaveLength(2);
    expect(demoReports.filter((report) => report.decision !== null)).toHaveLength(1);
  });
});
