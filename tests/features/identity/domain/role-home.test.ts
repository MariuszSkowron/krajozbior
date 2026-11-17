import { describe, expect, it } from "vitest";

import { roles } from "@/features/identity/domain/actor";
import { roleHome, roleLabels } from "@/features/identity/domain/role-home";

describe("roleLabels", () => {
  it("names every role in Polish", () => {
    expect(roles.map((role) => roleLabels[role])).toEqual(["Użytkownik", "Administrator"]);
  });
});

describe("roleHome", () => {
  it.each(roles)("sends %s to the account view", (role) => {
    expect(roleHome(role)).toBe("/my");
  });
});
