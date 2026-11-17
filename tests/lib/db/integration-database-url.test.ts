import { describe, expect, it } from "vitest";

import { parseIntegrationDatabaseUrl } from "../../support/integration-database-url";

describe("parseIntegrationDatabaseUrl", () => {
  it("accepts the dedicated local integration database", () => {
    expect(
      parseIntegrationDatabaseUrl(
        "postgres://starter_test:test_password@localhost:5432/starter_integration_test",
      ),
    ).toBe("postgres://starter_test:test_password@localhost:5432/starter_integration_test");
  });

  it.each([
    undefined,
    "postgres://starter:secret@localhost:5432/starter",
    "postgres://starter_test:test_password@database.internal:5432/starter_integration_test",
    "mysql://starter_test:test_password@localhost:3306/starter_integration_test",
  ])("rejects unsafe integration database URLs: %j", (value) => {
    expect(() => parseIntegrationDatabaseUrl(value)).toThrow(
      "TEST_DATABASE_URL must target localhost database starter_integration_test",
    );
  });
});
