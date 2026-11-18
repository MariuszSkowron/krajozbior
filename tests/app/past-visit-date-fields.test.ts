import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PastVisitDateFields } from "@/app/past-visit-date-fields";
import { PastVisitMessage } from "@/app/past-visit-message";
import {
  EMPTY_PAST_VISIT_DATE,
  type PastVisitDateForm,
} from "@/features/visits/domain/past-visit-form";

function render(patch: Partial<PastVisitDateForm>): string {
  return renderToStaticMarkup(
    createElement(PastVisitDateFields, {
      legend: "Kiedy tu byłeś?",
      value: { ...EMPTY_PAST_VISIT_DATE, ...patch },
      onChange: () => undefined,
    }),
  );
}

// The wrappers of the three groups of fields, in the order of the markup.
function groups(html: string): { day: string; month: string; year: string } {
  // The first <div> is the group of radios (it has no `hidden`); the next three are the fields.
  const fields = [...html.matchAll(/<div\b[^>]*>/g)]
    .slice(1)
    .map((match) => (match[0].includes("hidden") ? "hidden" : "shown"));

  return { day: fields[0] ?? "", month: fields[1] ?? "", year: fields[2] ?? "" };
}

describe("PastVisitDateFields", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 18, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides the groups of the other precisions with `hidden` and shows only the chosen one", () => {
    expect(groups(render({ precision: "month" }))).toEqual({
      day: "hidden",
      month: "shown",
      year: "hidden",
    });
    expect(groups(render({ precision: "day" }))).toEqual({
      day: "shown",
      month: "hidden",
      year: "hidden",
    });
    expect(groups(render({ precision: "year" }))).toEqual({
      day: "hidden",
      month: "hidden",
      year: "shown",
    });
    expect(groups(render({ precision: "unknown" }))).toEqual({
      day: "hidden",
      month: "hidden",
      year: "hidden",
    });
  });

  it("keeps the fields of the hidden groups in the page (hidden, not disabled)", () => {
    const html = render({ precision: "unknown", day: "2019-03-12" });

    expect(html).toContain('type="date"');
    expect(html).toContain('value="2019-03-12"');
    expect(html).not.toContain("disabled");
  });

  it("does not allow a day after today of the device (the server decides anyway)", () => {
    expect(render({ precision: "day" })).toContain('min="1900-01-01" max="2026-11-18"');
  });
});

describe("PastVisitMessage", () => {
  it("renders both live regions at all times, so each one is announced when text appears", () => {
    const html = (message: string, failed: boolean) =>
      renderToStaticMarkup(
        createElement(PastVisitMessage, {
          message,
          failed,
          statusRef: { current: null },
          alertRef: { current: null },
        }),
      );

    const idle = html("", false);

    expect(idle).toMatch(/<p[^>]*role="status"[^>]*><\/p>/);
    expect(idle).toMatch(/<p[^>]*role="alert"[^>]*><\/p>/);

    const saved = html("Zapisano.", false);

    expect(saved).toMatch(/role="status"[^>]*>Zapisano\.<\/p>/);
    expect(saved).toMatch(/role="alert"[^>]*><\/p>/);

    const failure = html("Błąd.", true);

    expect(failure).toMatch(/role="alert"[^>]*>Błąd\.<\/p>/);
    expect(failure).toMatch(/role="status"[^>]*><\/p>/);
  });
});
