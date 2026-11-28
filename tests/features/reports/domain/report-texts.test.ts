import { describe, expect, it } from "vitest";

import {
  CURATOR_SEES_NOTICE,
  DAILY_LIMIT_MESSAGE,
  DUPLICATE_OPEN_MESSAGE,
  formatCharactersLeft,
  formatCounterOver,
  formatFormHeading,
  formatMessageTooLong,
  MESSAGE_INVALID_ERROR,
  formatMyReportState,
  formatPlaceName,
  formatRejectReason,
  formatReportCount,
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
      "Dziękujemy. Zgłoszenie trafiło do: Gmina Tczew. Decyzję zobaczysz w „Moich zgłoszeniach”.",
    );
  });

  it("declines the number of characters left (1, 2-4, 5+, 12-14, 22)", () => {
    expect(formatCharactersLeft(1)).toBe("Został 1 znak.");
    expect(formatCharactersLeft(2)).toBe("Zostały 2 znaki.");
    expect(formatCharactersLeft(4)).toBe("Zostały 4 znaki.");
    expect(formatCharactersLeft(5)).toBe("Zostało 5 znaków.");
    expect(formatCharactersLeft(12)).toBe("Zostało 12 znaków.");
    expect(formatCharactersLeft(14)).toBe("Zostało 14 znaków.");
    expect(formatCharactersLeft(22)).toBe("Zostały 22 znaki.");
    expect(formatCharactersLeft(100)).toBe("Zostało 100 znaków.");
  });

  it("says how much too long a description is, declined (1, 2-4, 5+, 22)", () => {
    expect(formatMessageTooLong(1)).toBe("Opis jest za długi o 1 znak. Skróć go.");
    expect(formatMessageTooLong(3)).toBe("Opis jest za długi o 3 znaki. Skróć go.");
    expect(formatMessageTooLong(140)).toBe("Opis jest za długi o 140 znaków. Skróć go.");
    expect(formatCounterOver(22)).toBe("Za długi o 22 znaki");
    expect(formatCounterOver(5)).toBe("Za długi o 5 znaków");
  });

  it("blames invisible characters only in their own message, not the length", () => {
    expect(MESSAGE_INVALID_ERROR).toContain("niewidoczne znaki");
    expect(MESSAGE_INVALID_ERROR).not.toContain("1000");
    expect(formatMessageTooLong(10)).not.toContain("niewidoczne");
  });

  it("states the limit of open reports with the number of the limit", () => {
    expect(OPEN_LIMIT_MESSAGE).toContain(String(OPEN_REPORTS_PER_AUTHOR_LIMIT));
    expect(OPEN_LIMIT_MESSAGE).toBe(
      "Masz już 50 zgłoszeń czekających na kuratorów. Nowe wyślesz, gdy część z nich zostanie rozpatrzona.",
    );
  });

  it("states the rolling daily limit in words", () => {
    expect(DAILY_LIMIT_MESSAGE).toBe(
      "W ciągu ostatniej doby wysłano z Twojego konta 10 zgłoszeń. Kolejne wyślesz najpóźniej za 24 godziny.",
    );
  });

  it.each([
    [1, "1 zgłoszenie"],
    [3, "3 zgłoszenia"],
    [5, "5 zgłoszeń"],
    [10, "10 zgłoszeń"],
    [12, "12 zgłoszeń"],
    [13, "13 zgłoszeń"],
    [14, "14 zgłoszeń"],
    [22, "22 zgłoszenia"],
    [50, "50 zgłoszeń"],
    [112, "112 zgłoszeń"],
  ])("declines the number of reports: %i", (count, text) => {
    expect(formatReportCount(count)).toBe(text);
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
    expect(formatSubmitFailure(429, DAILY_LIMIT_MESSAGE)).toBe(DAILY_LIMIT_MESSAGE);
    expect(formatSubmitFailure(409, DUPLICATE_OPEN_MESSAGE)).toBe(DUPLICATE_OPEN_MESSAGE);
    // a 409 or 429 without a sentence of its own falls back to the general failure
    expect(formatSubmitFailure(429, undefined)).toBe(SUBMIT_UNAVAILABLE_MESSAGE);
    expect(formatSubmitFailure(409, "")).toBe(SUBMIT_UNAVAILABLE_MESSAGE);
    expect(formatSubmitFailure(401, undefined)).toBe(
      "Zaloguj się ponownie, żeby wysłać zgłoszenie.",
    );
    expect(formatSubmitFailure(403, undefined, "own_organization")).toBe(OWN_ORGANIZATION_NOTICE);
    // a 403 for another reason (a foreign origin) must not say "you run this place"
    expect(formatSubmitFailure(403, undefined, "forbidden_origin")).toBe(
      SUBMIT_UNAVAILABLE_MESSAGE,
    );
    expect(formatSubmitFailure(403, undefined)).toBe(SUBMIT_UNAVAILABLE_MESSAGE);
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
