import { polishPlural } from "@/features/catalog/domain/place-count";

import { DAILY_REPORT_LIMIT, OPEN_REPORTS_PER_AUTHOR_LIMIT } from "./limits";
import { REJECT_REASON_LABELS, type RejectReason, type ReportStatus } from "./report";

// Words the explorer reads about reports of a problem with a place (P4b, PR B): the form, the
// answers of the route and the state in "Moje zgłoszenia". Forms of address are neutral in gender.

/** Above the send button: said BEFORE sending (RODO art. 13; D-62 point 2). */
export const CURATOR_SEES_NOTICE =
  "Kurator zobaczy Twoje imię i pierwszą literę nazwiska (np. Anna K.), bez adresu e-mail.";

export const OWN_ORGANIZATION_NOTICE = "Prowadzisz to miejsce — popraw je w edytorze.";

export const MESSAGE_REQUIRED_ERROR =
  "Opisz problem — przy tym rodzaju kurator potrzebuje kilku słów.";

export const DAILY_LIMIT_MESSAGE = `Z Twojego konta wysłano w ciągu doby ${DAILY_REPORT_LIMIT} zgłoszeń. Kolejne wyślesz jutro.`;
export const BURST_LIMIT_MESSAGE = "Za dużo zgłoszeń w krótkim czasie. Spróbuj za chwilę.";
export const OPEN_LIMIT_MESSAGE = `Masz już ${OPEN_REPORTS_PER_AUTHOR_LIMIT} zgłoszeń czekających na kuratorów. Nowe wyślesz, gdy część z nich zostanie rozpatrzona.`;
export const PLACE_QUEUE_FULL_MESSAGE =
  "To miejsce ma już wiele zgłoszeń czekających na kuratora. Spróbuj za kilka dni.";
export const DUPLICATE_OPEN_MESSAGE =
  "Twoje zgłoszenie tego rodzaju już czeka na kuratora. Znajdziesz je w „Moich zgłoszeniach”.";

export const CATEGORY_REQUIRED_ERROR = "Wybierz rodzaj problemu.";
export const MESSAGE_INVALID_ERROR =
  "Opis może mieć do 1000 znaków. Usuń niewidoczne znaki skopiowane razem z tekstem.";
export const SUBMIT_UNAVAILABLE_MESSAGE =
  "Nie udało się wysłać zgłoszenia. Spróbuj ponownie za chwilę.";

export const LINK_REPORT_PROBLEM = "Zgłoś problem z miejscem";
export const MESSAGE_LABEL = "Co jest na miejscu inaczej?";
export const MESSAGE_HINT = "Na przykład: brama zamknięta, na tablicy przy wejściu inne godziny.";
export const MESSAGE_REQUIRED_HINT = "Przy tym rodzaju opis jest obowiązkowy.";
export const SUBMIT_LABEL = "Wyślij zgłoszenie";

export const MY_REPORTS_TITLE = "Moje zgłoszenia";
export const MY_REPORTS_EMPTY =
  "Nie masz jeszcze zgłoszeń. Jeśli coś na miejscu się nie zgadza, wybierz „Zgłoś problem z miejscem” na stronie miejsca.";
export const DISAGREE_PROMPT = "Nie zgadzasz się?";
export const DISAGREE_LINK = "Napisz do nas";

/** The heading of the form. */
export function formatFormHeading(placeName: string): string {
  return `Co jest nie tak z miejscem ${placeName}?`;
}

/** What a failed send says, by the answer of the route; the route's own sentence wins when it has one. */
export function formatSubmitFailure(status: number, message: unknown, error?: unknown): string {
  if ((status === 409 || status === 429) && typeof message === "string" && message !== "") {
    return message;
  }

  switch (status) {
    case 401:
      return "Zaloguj się ponownie, żeby wysłać zgłoszenie.";
    case 403:
      // Only this refusal is about the place; the others (e.g. a foreign origin) are a failure.
      return error === "own_organization" ? OWN_ORGANIZATION_NOTICE : SUBMIT_UNAVAILABLE_MESSAGE;
    case 404:
      return "Nie znaleziono tego miejsca.";
    case 413:
    case 422:
      return "Popraw opis i spróbuj jeszcze raz.";
    default:
      return SUBMIT_UNAVAILABLE_MESSAGE;
  }
}

/** After sending: the organization that will look at the report. */
export function formatSubmitted(organizationName: string): string {
  return `Dziękujemy. Zgłoszenie trafiło do: ${organizationName}. Decyzję zobaczysz w „Moich zgłoszeniach”.`;
}

/** The counter read to a screen reader near the limit: "Został 1 znak.", "Zostały 2 znaki.", "Zostało 5 znaków." */
export function formatCharactersLeft(left: number): string {
  return `${polishPlural(left, "Został", "Zostały", "Zostało")} ${left} ${polishPlural(left, "znak", "znaki", "znaków")}.`;
}

/** The state of a report as its author reads it. */
export function formatMyReportState(status: ReportStatus): string {
  switch (status) {
    case "open":
      return "Czeka na kuratora";
    case "accepted":
      return "Przyjęte — dziękujemy";
    case "rejected":
      return "Odrzucone";
  }
}

/** The line under a rejected report; empty for the other states. */
export function formatRejectReason(reason: RejectReason | null): string | null {
  return reason === null ? null : `Powód: ${REJECT_REASON_LABELS[reason]}`;
}

/** The sentence about a place that was removed after the report was sent. */
export function formatPlaceName(name: string, deleted: boolean): string {
  return deleted ? `${name} (miejsce usunięte)` : name;
}
