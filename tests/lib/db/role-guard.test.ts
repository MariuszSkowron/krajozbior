import { describe, expect, it } from "vitest";

import {
  assertSafeDatabaseRole,
  unsafeRoleQuery,
  UnsafeDatabaseRoleError,
} from "@/lib/db/role-guard";

const safe = { switched: false, privileged: false, owner: false, member: false };

describe("assertSafeDatabaseRole", () => {
  it("accepts a role with every flag false and asks the catalog about the current role", async () => {
    const queries: string[] = [];

    await assertSafeDatabaseRole(async (sql) => {
      queries.push(sql);
      return safe;
    });

    expect(queries).toEqual([unsafeRoleQuery]);
  });

  it.each(Object.keys(safe))("refuses a role when %s is true", async (flag) => {
    await expect(assertSafeDatabaseRole(async () => ({ ...safe, [flag]: true }))).rejects.toThrow(
      UnsafeDatabaseRoleError,
    );
  });

  it("fails closed when the role is missing or a flag is not a boolean", async () => {
    await expect(assertSafeDatabaseRole(async () => undefined)).rejects.toThrow(
      UnsafeDatabaseRoleError,
    );
    await expect(
      assertSafeDatabaseRole(async () => ({ ...safe, member: undefined })),
    ).rejects.toThrow(UnsafeDatabaseRoleError);
  });

  it("names the reason only", () => {
    expect(new UnsafeDatabaseRoleError().message).toBe(
      "Database role must not be privileged, own objects, belong to roles or switch roles",
    );
  });
});
