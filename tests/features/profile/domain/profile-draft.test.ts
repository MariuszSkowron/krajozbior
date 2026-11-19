import { describe, expect, it } from "vitest";

import { parseProfileDraft, serializeProfileDraft } from "@/features/profile/domain/profile-draft";

describe("profile draft cookie", () => {
  it("round-trips the four typed fields, in the framework form (decoded) and encoded", () => {
    const value = serializeProfileDraft({
      firstName: "Żaneta 2",
      familyInitial: "Ł",
      region: "lodzkie",
      visibility: "public",
      userId: "ignored",
    });
    const expected = {
      firstName: "Żaneta 2",
      familyInitial: "Ł",
      region: "lodzkie",
      visibility: "public",
    };

    expect(value).not.toBeNull();
    expect(value).not.toMatch(/[{}" ]/);
    expect(parseProfileDraft(value ?? undefined)).toEqual(expected);
    expect(parseProfileDraft(decodeURIComponent(value ?? ""))).toEqual(expected);
  });

  it("keeps missing and non-string fields as empty text and cuts long values", () => {
    const parsed = parseProfileDraft(
      decodeURIComponent(serializeProfileDraft({ firstName: "A".repeat(500), region: 5 }) ?? ""),
    );

    expect(parsed?.firstName).toHaveLength(100);
    expect(parsed).toMatchObject({ familyInitial: "", region: "", visibility: "" });
  });

  it("gives nothing for a body that is not an object and for a damaged cookie", () => {
    expect(serializeProfileDraft(null)).toBeNull();
    expect(serializeProfileDraft("text")).toBeNull();
    expect(parseProfileDraft(undefined)).toBeNull();
    expect(parseProfileDraft("{broken")).toBeNull();
    expect(parseProfileDraft("%E0%A4%A")).toBeNull();
    expect(parseProfileDraft("[1]")).toMatchObject({ firstName: "" });
    expect(parseProfileDraft("5")).toBeNull();
    expect(parseProfileDraft("null")).toBeNull();
  });
});
