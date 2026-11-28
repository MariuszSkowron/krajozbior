import { describe, expect, it } from "vitest";

import {
  CURATOR_SEES_NOTICE,
  formatMyReportState,
  formatPlaceName,
  formatRejectReason,
  formatSubmitted,
  OPEN_LIMIT_MESSAGE,
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

  it("marks a place that was removed after the report", () => {
    expect(formatPlaceName("Most Tczewski", false)).toBe("Most Tczewski");
    expect(formatPlaceName("Most Tczewski", true)).toBe("Most Tczewski (miejsce usunięte)");
  });
});
