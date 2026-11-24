import { describe, expect, it } from "vitest";

import {
  applicationScreenState,
  mayApply,
  type ApplicationScreenState,
} from "@/features/curator-applications/domain/application-state";
import { ORGANIZATION_KIND_LABELS } from "@/features/curator-applications/domain/organization-kind-labels";
import {
  PREVIEW_COLLECTIONS,
  PREVIEW_ORGANIZATION_NAME,
} from "@/features/curator-applications/domain/preview-data";
import { ORGANIZATION_KINDS } from "@/features/organizations/domain/organization";

describe("applicationScreenState", () => {
  const facts = (status: "pending" | "approved" | "rejected", isMember = false, ok = true) => ({
    status,
    isMember,
    organizationApproved: ok,
  });

  it.each([
    [null, "none"],
    [facts("pending"), "pending"],
    [facts("rejected"), "rejected"],
    [facts("approved", true, true), "approved_member"],
    [facts("approved", true, false), "approved_suspended"],
    [facts("approved", false, true), "approved_revoked"],
  ] as const)("maps %j to %s", (input, expected) => {
    expect(applicationScreenState(input)).toBe(expected);
  });
});

describe("mayApply", () => {
  it("is false only while an application waits for a decision", () => {
    const states: ApplicationScreenState[] = [
      "none",
      "pending",
      "approved_member",
      "approved_revoked",
      "approved_suspended",
      "rejected",
    ];

    expect(states.filter((state) => !mayApply(state))).toEqual(["pending"]);
  });
});

describe("labels and preview data", () => {
  it("labels every organization kind", () => {
    expect(Object.keys(ORGANIZATION_KIND_LABELS).sort()).toEqual([...ORGANIZATION_KINDS].sort());
  });

  it("marks every preview name as an example", () => {
    expect(PREVIEW_ORGANIZATION_NAME).toContain("(przykład)");
    expect(PREVIEW_COLLECTIONS.length).toBeGreaterThan(0);
    for (const collection of PREVIEW_COLLECTIONS) {
      expect(collection.title).toContain("(przykład)");
      for (const place of collection.places) {
        expect(place.name).toContain("(przykład)");
      }
    }
  });
});
