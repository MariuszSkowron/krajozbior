import { describe, expect, it } from "vitest";

import { roles } from "@/features/identity/domain/actor";
import { roleHome, roleLabels, signInDestination } from "@/features/identity/domain/role-home";

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

describe("signInDestination", () => {
  it("prefers a returnTo, also for a curator", () => {
    expect(signInDestination({ returnTo: "/collections/x", isCurator: true })).toBe(
      "/collections/x",
    );
    expect(signInDestination({ returnTo: "/collections/x", isCurator: false })).toBe(
      "/collections/x",
    );
  });

  it("sends a curator without returnTo to the panel", () => {
    expect(signInDestination({ returnTo: null, isCurator: true })).toBe("/curator");
  });

  it("sends everyone else to the account view", () => {
    expect(signInDestination({ returnTo: null, isCurator: false })).toBe("/my");
  });
});
