import { describe, expect, it } from "vitest";

import { parseIntegrationDatabaseUrl } from "../../support/integration-database-url";

describe("parseIntegrationDatabaseUrl", () => {
  it("accepts the dedicated local integration database", () => {
    expect(
      parseIntegrationDatabaseUrl(
        "postgres://krajozbior_test:test_password@localhost:5432/krajozbior_integration_test",
      ),
    ).toBe("postgres://krajozbior_test:test_password@localhost:5432/krajozbior_integration_test");
  });

  it.each([
    undefined,
    "postgres://krajozbior:secret@localhost:5432/krajozbior",
    "postgres://krajozbior_test:test_password@database.internal:5432/krajozbior_integration_test",
    "mysql://krajozbior_test:test_password@localhost:3306/krajozbior_integration_test",
  ])("rejects unsafe integration database URLs: %j", (value) => {
    expect(() => parseIntegrationDatabaseUrl(value)).toThrow(
      "TEST_DATABASE_URL must target localhost database krajozbior_integration_test",
    );
  });
});
