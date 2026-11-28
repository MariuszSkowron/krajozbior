import { OPEN_REPORTS_PER_AUTHOR_LIMIT } from "./limits";
import { REJECT_REASON_LABELS, type RejectReason, type ReportStatus } from "./report";

// Words the explorer reads about reports of a problem with a place (P4b, PR B): the form, the
// answers of the route and the state in "Moje zgłoszenia". Forms of address are neutral in gender.

/** Above the send button: said BEFORE sending (RODO art. 13; D-62 point 2). */
export const CURATOR_SEES_NOTICE =
  "Kurator zobaczy Twoje imię i pierwszą literę nazwiska (np. Anna K.), bez adresu e-mail.";

export const OWN_ORGANIZATION_NOTICE = "Prowadzisz to miejsce — popraw je w edytorze.";

export const MESSAGE_REQUIRED_ERROR =
  "Opisz problem — przy tej kategorii kurator potrzebuje kilku słów.";

export const DAILY_LIMIT_MESSAGE = "Wysłano już dużo zgłoszeń. Spróbuj jutro.";
export const BURST_LIMIT_MESSAGE = "Za dużo zgłoszeń w krótkim czasie. Spróbuj za chwilę.";
export const OPEN_LIMIT_MESSAGE = `Masz już ${OPEN_REPORTS_PER_AUTHOR_LIMIT} zgłoszeń czekających na kuratorów. Nowe wyślesz, gdy część z nich zostanie rozpatrzona.`;
export const PLACE_QUEUE_FULL_MESSAGE =
  "To miejsce ma już wiele zgłoszeń czekających na kuratora. Kurator się nimi zajmuje.";
export const DUPLICATE_OPEN_MESSAGE = "Masz już otwarte zgłoszenie tego rodzaju dla tego miejsca.";

/** After sending: the organization that will look at the report. */
export function formatSubmitted(organizationName: string): string {
  return `Dziękujemy. Kurator ${organizationName} sprawdzi zgłoszenie. Jego decyzję zobaczysz w „Moich zgłoszeniach”.`;
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
