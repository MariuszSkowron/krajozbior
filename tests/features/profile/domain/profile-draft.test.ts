import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearedProfileDraftCookie,
  parseProfileDraft,
  profileDraftCookie,
  serializeProfileDraft,
} from "@/features/profile/domain/profile-draft";

describe("profile draft Set-Cookie value", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is HttpOnly, scoped to the settings path and Secure only in production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(profileDraftCookie("x", 120)).toBe(
      "profile-draft=x; Path=/my/settings; Max-Age=120; HttpOnly; SameSite=Lax",
    );

    vi.stubEnv("NODE_ENV", "production");
    expect(profileDraftCookie("x", 120)).toBe(
      "profile-draft=x; Path=/my/settings; Max-Age=120; HttpOnly; SameSite=Lax; Secure",
    );
  });

  it("clears the draft with an empty value and max age 0", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(clearedProfileDraftCookie()).toBe(
      "profile-draft=; Path=/my/settings; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
    );
  });
});

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
