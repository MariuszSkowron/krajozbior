import { describe, expect, it } from "vitest";

import {
  DECISION_NOTE_MAX_LENGTH,
  formatOpenReportsCounter,
  formatQueueOverflow,
  isRejectReason,
  isReportCategory,
  isReportQueueState,
  MAX_OPEN_REPORTS_SHOWN,
  normalizeLineBreaks,
  REJECT_REASON_LABELS,
  REJECT_REASONS,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  validateDecisionInput,
} from "@/features/reports/domain/report";

describe("lists of the reports", () => {
  it("names every category and every reason in Polish", () => {
    for (const category of REPORT_CATEGORIES) {
      expect(REPORT_CATEGORY_LABELS[category]).not.toBe("");
    }
    for (const reason of REJECT_REASONS) {
      expect(REJECT_REASON_LABELS[reason]).not.toBe("");
    }
  });

  it("recognizes only the listed values", () => {
    expect(isReportCategory("closed")).toBe(true);
    expect(isReportCategory("nope")).toBe(false);
    expect(isReportCategory(3)).toBe(false);
    expect(isRejectReason("abuse")).toBe(true);
    expect(isRejectReason(undefined)).toBe(false);
    expect(isReportQueueState("decided")).toBe(true);
    expect(isReportQueueState("all")).toBe(false);
  });

  it("normalizes line breaks", () => {
    expect(normalizeLineBreaks("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});

describe("validateDecisionInput", () => {
  it("accepts accept with a note and drops the reason", () => {
    expect(
      validateDecisionInput({
        action: "accept",
        reason: "abuse",
        note: " ok\r\ndalej ",
        version: 2,
      }),
    ).toEqual({
      ok: true,
      value: { action: "accept", reason: null, note: "ok\ndalej", version: 2 },
    });
  });

  it("treats an empty or missing note as none", () => {
    expect(validateDecisionInput({ action: "accept", note: "   ", version: 1 })).toMatchObject({
      ok: true,
      value: { note: null },
    });
    expect(validateDecisionInput({ action: "accept", note: null, version: 1 })).toMatchObject({
      ok: true,
      value: { note: null },
    });
    expect(validateDecisionInput({ action: "accept", version: 1 })).toMatchObject({
      ok: true,
      value: { note: null },
    });
  });

  it("requires a reason to reject and keeps it", () => {
    expect(validateDecisionInput({ action: "reject", version: 1 })).toEqual({
      ok: false,
      errors: ["reason"],
    });
    expect(validateDecisionInput({ action: "reject", reason: "other", version: 1 })).toMatchObject({
      ok: true,
      value: { action: "reject", reason: "other" },
    });
  });

  it("sends no note with an undo", () => {
    expect(validateDecisionInput({ action: "undo", note: "ignored", version: 3 })).toMatchObject({
      ok: true,
      value: { action: "undo", note: null, reason: null },
    });
  });

  it("refuses an unknown action without looking at the rest", () => {
    expect(validateDecisionInput({ action: "delete", version: 1 })).toEqual({
      ok: false,
      errors: ["action"],
    });
    expect(validateDecisionInput({})).toEqual({ ok: false, errors: ["action", "version"] });
  });

  it("refuses a note that is too long, not text, or holds hidden characters", () => {
    const long = "ą".repeat(DECISION_NOTE_MAX_LENGTH + 1);

    for (const note of [long, 5, "ukryte​tekst", "kierunek‮tekstu", "ster\u0007owanie"]) {
      expect(validateDecisionInput({ action: "accept", note, version: 1 })).toEqual({
        ok: false,
        errors: ["note"],
      });
    }
    // a note of exactly the limit and a line feed are fine
    expect(
      validateDecisionInput({
        action: "accept",
        note: `${"ą".repeat(DECISION_NOTE_MAX_LENGTH - 2)}\nb`,
        version: 1,
      }).ok,
    ).toBe(true);
  });

  it("requires a positive whole version", () => {
    for (const version of [0, -1, 1.5, "1", undefined, Number.NaN]) {
      expect(validateDecisionInput({ action: "accept", version })).toEqual({
        ok: false,
        errors: ["version"],
      });
    }
  });
});

describe("texts of the counters", () => {
  it("says plainly that nothing waits", () => {
    expect(formatOpenReportsCounter(0)).toBe("Zgłoszenia: nic nie czeka");
    expect(formatOpenReportsCounter(3)).toBe("Zgłoszenia do sprawdzenia: 3");
  });

  it("warns only when the queue is longer than it shows", () => {
    expect(formatQueueOverflow(MAX_OPEN_REPORTS_SHOWN)).toBeNull();
    expect(formatQueueOverflow(201)).toBe(
      "Pokazano 200 najstarszych z 201. Rozpatrz je, a zobaczysz kolejne.",
    );
  });
});
