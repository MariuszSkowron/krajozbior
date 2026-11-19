import { describe, expect, it } from "vitest";

import { REGIONS } from "@/features/catalog/domain/collection";
import {
  DEFAULT_PROFILE,
  FIRST_NAME_MAX_LENGTH,
  VISIBILITIES,
  parseProfileInput,
} from "@/features/profile/domain/profile";

const valid = { firstName: "Anna", familyInitial: "K", region: "pomorskie", visibility: "public" };

describe("DEFAULT_PROFILE", () => {
  it("is private and has no name (Q1, D-E9-2)", () => {
    expect(DEFAULT_PROFILE).toEqual({
      firstName: null,
      familyInitial: null,
      region: null,
      visibility: "private",
    });
  });
});

describe("parseProfileInput", () => {
  it("reads a full profile", () => {
    expect(parseProfileInput(valid)).toEqual({ ok: true, value: valid });
  });

  it("turns blank first name, initial and region into null, and trims", () => {
    for (const blank of [undefined, null, "", "   "]) {
      expect(
        parseProfileInput({
          firstName: blank,
          familyInitial: blank,
          region: blank,
          visibility: "private",
        }),
      ).toEqual({ ok: true, value: DEFAULT_PROFILE });
    }

    expect(parseProfileInput({ ...valid, firstName: "  Anna  " })).toMatchObject({
      ok: true,
      value: { firstName: "Anna" },
    });
  });

  it("accepts Polish letters, hyphen, apostrophe and spaces between parts of a name", () => {
    for (const name of ["Żaneta", "Anna-Maria", "Jan Maria", "O'Brien", "D’Artagnan", "Łukasz"]) {
      expect(parseProfileInput({ ...valid, firstName: name }), name).toMatchObject({
        ok: true,
        value: { firstName: name },
      });
    }
  });

  it("composes decomposed letters (NFC) before counting and checking", () => {
    const decomposed = "Zóha";
    const result = parseProfileInput({ ...valid, firstName: decomposed });

    expect(result).toMatchObject({ ok: true, value: { firstName: "Zóha" } });
  });

  it("accepts the longest name and refuses a longer one, counting characters", () => {
    const longest = "A".repeat(FIRST_NAME_MAX_LENGTH);

    expect(parseProfileInput({ ...valid, firstName: longest })).toMatchObject({ ok: true });
    expect(parseProfileInput({ ...valid, firstName: `${longest}A` })).toEqual({
      ok: false,
      fields: ["firstName"],
    });
  });

  it("refuses digits, symbols, doubled or dangling separators and control characters", () => {
    for (const name of [
      "Anna2",
      "An_na",
      "Anna  Maria",
      "-Anna",
      "Anna-",
      "Anna\nMaria",
      "<b>",
      "😀",
    ]) {
      expect(parseProfileInput({ ...valid, firstName: name }), JSON.stringify(name)).toEqual({
        ok: false,
        fields: ["firstName"],
      });
    }
  });

  it("stores the initial in uppercase, also from a lowercase letter", () => {
    expect(parseProfileInput({ ...valid, familyInitial: "ż" })).toMatchObject({
      ok: true,
      value: { familyInitial: "Ż" },
    });
  });

  it("refuses an initial that is not one letter", () => {
    for (const initial of ["KO", "1", ".", "ß", 5]) {
      expect(parseProfileInput({ ...valid, familyInitial: initial }), String(initial)).toEqual({
        ok: false,
        fields: ["familyInitial"],
      });
    }
  });

  it("refuses an initial without a first name and points at the name", () => {
    expect(parseProfileInput({ ...valid, firstName: "" })).toEqual({
      ok: false,
      fields: ["firstName"],
    });
    expect(parseProfileInput({ ...valid, firstName: undefined })).toEqual({
      ok: false,
      fields: ["firstName"],
    });
  });

  it("reports an invalid name once even when an initial is also given", () => {
    expect(parseProfileInput({ ...valid, firstName: "Anna2" })).toEqual({
      ok: false,
      fields: ["firstName"],
    });
  });

  it("accepts every voivodeship and refuses anything else", () => {
    for (const region of REGIONS) {
      expect(parseProfileInput({ ...valid, region })).toMatchObject({ ok: true });
    }

    for (const region of ["Pomorskie", "polska", 7]) {
      expect(parseProfileInput({ ...valid, region }), String(region)).toEqual({
        ok: false,
        fields: ["region"],
      });
    }
  });

  it("requires a known visibility", () => {
    for (const visibility of VISIBILITIES) {
      expect(parseProfileInput({ ...valid, visibility })).toMatchObject({ ok: true });
    }

    for (const visibility of [undefined, null, "friends", true]) {
      expect(parseProfileInput({ ...valid, visibility }), String(visibility)).toEqual({
        ok: false,
        fields: ["visibility"],
      });
    }
  });

  it("refuses non-text values of the text fields", () => {
    expect(parseProfileInput({ ...valid, firstName: 12, familyInitial: {} })).toEqual({
      ok: false,
      fields: ["firstName", "familyInitial"],
    });
  });

  it("lists every wrong field", () => {
    expect(
      parseProfileInput({ firstName: "1", familyInitial: "11", region: "x", visibility: "x" }),
    ).toEqual({ ok: false, fields: ["firstName", "familyInitial", "region", "visibility"] });
  });

  it("refuses a body that is not an object, or names anything else, such as an owner", () => {
    for (const body of [undefined, null, "text", 5, [], [valid]]) {
      expect(parseProfileInput(body)).toEqual({ ok: false, fields: [] });
    }

    expect(parseProfileInput({ ...valid, userId: "11111111-1111-4111-8111-111111111111" })).toEqual(
      {
        ok: false,
        fields: [],
      },
    );
  });
});
