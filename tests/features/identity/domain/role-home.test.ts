import { describe, expect, it } from "vitest";

import { roles } from "@/features/identity/domain/actor";
import {
  isNewExplorerAccount,
  roleLabels,
  signInDestination,
} from "@/features/identity/domain/role-home";

describe("roleLabels", () => {
  it("names every role in Polish", () => {
    expect(roles.map((role) => roleLabels[role])).toEqual(["Użytkownik", "Administrator"]);
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
    expect(signInDestination({ returnTo: null, isCurator: false, isNewExplorer: false })).toBe(
      "/my",
    );
  });

  it("sends an account with no visit and no saved collection to the start page", () => {
    expect(signInDestination({ returnTo: null, isCurator: false, isNewExplorer: true })).toBe("/");
  });

  it("keeps a returnTo and the curator panel over the start page", () => {
    expect(
      signInDestination({ returnTo: "/collections/x", isCurator: false, isNewExplorer: true }),
    ).toBe("/collections/x");
    expect(signInDestination({ returnTo: null, isCurator: true, isNewExplorer: true })).toBe(
      "/curator",
    );
  });
});

describe("isNewExplorerAccount", () => {
  it("is true only with no visit and no saved collection", () => {
    expect(isNewExplorerAccount({ discoveredPlaces: 0, savedCollections: 0 })).toBe(true);
    expect(isNewExplorerAccount({ discoveredPlaces: 1, savedCollections: 0 })).toBe(false);
    expect(isNewExplorerAccount({ discoveredPlaces: 0, savedCollections: 1 })).toBe(false);
    expect(isNewExplorerAccount({ discoveredPlaces: 3, savedCollections: 2 })).toBe(false);
  });
});
