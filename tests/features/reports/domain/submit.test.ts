import { describe, expect, it } from "vitest";

import { REPORT_MESSAGE_MAX_LENGTH } from "@/features/reports/domain/limits";
import { REPORT_CATEGORIES } from "@/features/reports/domain/report";
import { isTextRequired, validateSubmitInput } from "@/features/reports/domain/submit";

describe("validateSubmitInput", () => {
  it("accepts every kind with a description, and the kinds that explain themselves without one", () => {
    for (const category of REPORT_CATEGORIES) {
      expect(validateSubmitInput({ category, message: "Brama jest zamknięta" }), category).toEqual({
        ok: true,
        value: { category, message: "Brama jest zamknięta" },
      });
    }

    expect(validateSubmitInput({ category: "closed" })).toEqual({
      ok: true,
      value: { category: "closed", message: "" },
    });
    expect(validateSubmitInput({ category: "missing", message: null })).toEqual({
      ok: true,
      value: { category: "missing", message: "" },
    });
  });

  it("needs words for the kinds 'Inne' and 'Błąd w opisie, adresie lub dostępie'", () => {
    expect(isTextRequired("other")).toBe(true);
    expect(isTextRequired("wrong_info")).toBe(true);
    expect(isTextRequired("closed")).toBe(false);

    for (const category of ["other", "wrong_info"]) {
      expect(validateSubmitInput({ category }), category).toEqual({
        ok: false,
        errors: ["message"],
      });
      expect(validateSubmitInput({ category, message: " \n " }), category).toEqual({
        ok: false,
        errors: ["message"],
      });
    }
  });

  it("refuses an unknown kind, also together with a bad description", () => {
    expect(validateSubmitInput({})).toEqual({ ok: false, errors: ["category"] });
    expect(validateSubmitInput({ category: "nope", message: "x" })).toEqual({
      ok: false,
      errors: ["category"],
    });
    expect(validateSubmitInput({ category: 3, message: 7 })).toEqual({
      ok: false,
      errors: ["category", "message"],
    });
  });

  it("trims the description and counts a line break once", () => {
    const twoLines = "a\r\nb";

    expect(validateSubmitInput({ category: "closed", message: `  ${twoLines}  ` })).toEqual({
      ok: true,
      value: { category: "closed", message: "a\nb" },
    });
    // the limit counts characters of the text with LF, so CRLF pairs do not eat it
    const text = "a\r\n".repeat(REPORT_MESSAGE_MAX_LENGTH / 2 - 1) + "ab";

    expect(validateSubmitInput({ category: "closed", message: text }).ok).toBe(true);
  });

  it("refuses a description over 1000 characters, counting characters and not code units", () => {
    expect(
      validateSubmitInput({ category: "closed", message: "a".repeat(REPORT_MESSAGE_MAX_LENGTH) })
        .ok,
    ).toBe(true);
    expect(
      validateSubmitInput({
        category: "closed",
        message: "a".repeat(REPORT_MESSAGE_MAX_LENGTH + 1),
      }),
    ).toEqual({ ok: false, errors: ["message"] });
    // an emoji is one character, two UTF-16 units
    expect(
      validateSubmitInput({ category: "closed", message: "😀".repeat(REPORT_MESSAGE_MAX_LENGTH) })
        .ok,
    ).toBe(true);
  });

  it("refuses control, zero-width and text-direction characters in the description", () => {
    const around = (code: number) => `a${String.fromCodePoint(code)}b`;

    for (const bad of [0x0000, 0x0007, 0x200b, 0x202e, 0x2066, 0x009f].map(around)) {
      expect(validateSubmitInput({ category: "closed", message: bad }), bad).toEqual({
        ok: false,
        errors: ["message"],
      });
    }

    // a line feed and the usual Polish letters stay
    expect(validateSubmitInput({ category: "closed", message: "Zażółć\ngęślą jaźń" }).ok).toBe(
      true,
    );
  });
});
