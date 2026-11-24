import { describe, expect, it } from "vitest";

import {
  findSimilarOrganizationName,
  revocationReasonSchema,
  suggestOrganizationSlug,
  validateDecisionInput,
} from "@/features/curator-applications/domain/decision";

const uuid = "0b6f7a3e-4c1d-4f8a-9b2e-5d6c7e8f9a0b";

describe("validateDecisionInput", () => {
  it("reads a rejection with a trimmed reason", () => {
    expect(
      validateDecisionInput({ decision: "reject", reason: "  Nie znamy organizacji.  " }),
    ).toEqual({ ok: true, value: { decision: "reject", reason: "Nie znamy organizacji." } });
  });

  it("allows an address in the reason of a rejection (it is not written to the audit)", () => {
    expect(
      validateDecisionInput({ decision: "reject", reason: "Napisz na biuro@example.com" }).ok,
    ).toBe(true);
  });

  it.each(["", "   ", "a\nb", "a".repeat(401), 5, undefined])(
    "refuses the rejection reason %j",
    (reason) => {
      expect(validateDecisionInput({ decision: "reject", reason })).toEqual({ ok: false });
    },
  );

  it("reads an approval into an existing organization", () => {
    expect(validateDecisionInput({ decision: "approve", organizationId: uuid })).toEqual({
      ok: true,
      value: { decision: "approve", target: { kind: "existing", organizationId: uuid } },
    });
  });

  it("reads an approval into a new organization", () => {
    expect(
      validateDecisionInput({
        decision: "approve",
        organizationName: "  Gmina Rumia ",
        organizationSlug: "gmina-rumia",
      }),
    ).toEqual({
      ok: true,
      value: {
        decision: "approve",
        target: { kind: "new", name: "Gmina Rumia", slug: "gmina-rumia" },
      },
    });
  });

  it.each([
    [{ decision: "approve" }],
    [{ decision: "approve", organizationId: "not-a-uuid" }],
    [{ decision: "approve", organizationId: uuid, organizationName: "A", organizationSlug: "a" }],
    [{ decision: "approve", organizationName: "Gmina" }],
    [{ decision: "approve", organizationSlug: "gmina" }],
    [{ decision: "approve", organizationName: "   ", organizationSlug: "gmina" }],
    [{ decision: "approve", organizationName: "Gm\u0007ina", organizationSlug: "gmina" }],
    [{ decision: "approve", organizationName: "Gmina", organizationSlug: "Gmina Rumia" }],
    [{ decision: "approve", organizationName: "Gmina", organizationSlug: "-gmina" }],
    [{ decision: "approve", organizationName: "Gmina", organizationSlug: "a".repeat(61) }],
    [{ decision: "maybe" }],
    [null],
    ["approve"],
  ])("refuses %j", (body) => {
    expect(validateDecisionInput(body)).toEqual({ ok: false });
  });
});

describe("revocationReasonSchema", () => {
  it("accepts a reason without an address and refuses one with it", () => {
    expect(revocationReasonSchema.safeParse(" Koniec współpracy ").data).toBe("Koniec współpracy");
    expect(revocationReasonSchema.safeParse("Napisał jan@example.com").success).toBe(false);
    expect(revocationReasonSchema.safeParse("").success).toBe(false);
    expect(revocationReasonSchema.safeParse("a".repeat(401)).success).toBe(false);
  });
});

describe("suggestOrganizationSlug", () => {
  it("makes an ASCII address of the name, without a random suffix", () => {
    expect(suggestOrganizationSlug("Urząd Miejski w Rumi")).toBe("urzad-miejski-w-rumi");
    expect(suggestOrganizationSlug("Łódź — Oddział PTTK")).toBe("lodz-oddzial-pttk");
  });
});

describe("findSimilarOrganizationName", () => {
  const approved = ["Gmina Rumia", "Oddział PTTK Wejherowo"];

  it("finds a name that differs in case, spacing or Polish marks", () => {
    expect(findSimilarOrganizationName("  GMINA  rumia ", approved)).toBe("Gmina Rumia");
    expect(findSimilarOrganizationName("Oddzial PTTK Wejherowo", approved)).toBe(
      "Oddział PTTK Wejherowo",
    );
  });

  it("returns null for a new name", () => {
    expect(findSimilarOrganizationName("Gmina Reda", approved)).toBeNull();
    expect(findSimilarOrganizationName("Gmina Reda", [])).toBeNull();
  });
});
