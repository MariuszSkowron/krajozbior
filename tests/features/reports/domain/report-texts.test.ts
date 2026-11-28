import { describe, expect, it } from "vitest";

import {
  CURATOR_SEES_NOTICE,
  DUPLICATE_OPEN_MESSAGE,
  formatFormHeading,
  formatMyReportState,
  formatPlaceName,
  formatRejectReason,
  formatSubmitFailure,
  formatSubmitted,
  OPEN_LIMIT_MESSAGE,
  OWN_ORGANIZATION_NOTICE,
  SUBMIT_UNAVAILABLE_MESSAGE,
} from "@/features/reports/domain/report-texts";
import { OPEN_REPORTS_PER_AUTHOR_LIMIT } from "@/features/reports/domain/limits";

describe("texts of reports for the explorer", () => {
  it("says before sending what the curator sees (D-62 point 2)", () => {
    expect(CURATOR_SEES_NOTICE).toBe(
      "Kurator zobaczy Twoje imię i pierwszą literę nazwiska (np. Anna K.), bez adresu e-mail.",
    );
  });

  it("names the organization that will look at the report", () => {
    expect(formatSubmitted("Gmina Tczew")).toBe(
      "Dziękujemy. Kurator Gmina Tczew sprawdzi zgłoszenie. Jego decyzję zobaczysz w „Moich zgłoszeniach”.",
    );
  });

  it("states the limit of open reports with the number of the limit", () => {
    expect(OPEN_LIMIT_MESSAGE).toContain(String(OPEN_REPORTS_PER_AUTHOR_LIMIT));
  });

  it("says the state of a report in words", () => {
    expect(formatMyReportState("open")).toBe("Czeka na kuratora");
    expect(formatMyReportState("accepted")).toBe("Przyjęte — dziękujemy");
    expect(formatMyReportState("rejected")).toBe("Odrzucone");
  });

  it("says why a report was rejected, and nothing when there is no reason", () => {
    expect(formatRejectReason("duplicate")).toBe("Powód: Zgłoszenie się powtarza");
    expect(formatRejectReason("abuse")).toBe("Powód: Nadużycie");
    expect(formatRejectReason(null)).toBeNull();
  });

  it("heads the form with the name of the place", () => {
    expect(formatFormHeading("Most Tczewski")).toBe("Co jest nie tak z miejscem Most Tczewski?");
  });

  it("says why a send failed: the sentence of the route for a limit or a duplicate, else by the status", () => {
    expect(formatSubmitFailure(429, "Wysłano już dużo zgłoszeń. Spróbuj jutro.")).toBe(
      "Wysłano już dużo zgłoszeń. Spróbuj jutro.",
    );
    expect(formatSubmitFailure(409, DUPLICATE_OPEN_MESSAGE)).toBe(DUPLICATE_OPEN_MESSAGE);
    // a 409 or 429 without a sentence of its own falls back to the general failure
    expect(formatSubmitFailure(429, undefined)).toBe(SUBMIT_UNAVAILABLE_MESSAGE);
    expect(formatSubmitFailure(409, "")).toBe(SUBMIT_UNAVAILABLE_MESSAGE);
    expect(formatSubmitFailure(401, undefined)).toBe(
      "Zaloguj się ponownie, żeby wysłać zgłoszenie.",
    );
    expect(formatSubmitFailure(403, undefined)).toBe(OWN_ORGANIZATION_NOTICE);
    expect(formatSubmitFailure(404, undefined)).toBe("Nie znaleziono tego miejsca.");
    expect(formatSubmitFailure(413, undefined)).toBe("Popraw opis i spróbuj jeszcze raz.");
    expect(formatSubmitFailure(422, undefined)).toBe("Popraw opis i spróbuj jeszcze raz.");
    expect(formatSubmitFailure(503, undefined)).toBe(SUBMIT_UNAVAILABLE_MESSAGE);
  });

  it("marks a place that was removed after the report", () => {
    expect(formatPlaceName("Most Tczewski", false)).toBe("Most Tczewski");
    expect(formatPlaceName("Most Tczewski", true)).toBe("Most Tczewski (miejsce usunięte)");
  });
});
