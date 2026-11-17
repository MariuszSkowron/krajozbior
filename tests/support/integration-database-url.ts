import { z } from "zod";

const integrationDatabaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ }).refine((value) => {
  const url = new URL(value);

  return (
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.pathname === "/krajozbior_integration_test"
  );
});

export function parseIntegrationDatabaseUrl(value: string | undefined): string {
  const result = integrationDatabaseUrlSchema.safeParse(value);

  if (!result.success) {
    throw new Error("TEST_DATABASE_URL must target localhost database krajozbior_integration_test");
  }

  return result.data;
}
