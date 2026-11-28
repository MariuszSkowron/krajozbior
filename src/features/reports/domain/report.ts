// Reports of a problem with a place, the part a curator needs (P4b, PR A). Frozen copies
// of these lists live in the migration CHECKs (`Migration20261128010000_place_reports`);
// tests/integration/place-reports-access.test.ts compares them with these constants.

export const REPORT_CATEGORIES = [
  "missing",
  "closed",
  "private_or_unsafe",
  "wrong_location",
  "wrong_info",
  "other",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

// Polish names shown to people (the stored value is the key).
export const REPORT_CATEGORY_LABELS: Readonly<Record<ReportCategory, string>> = {
  missing: "Miejsce nie istnieje",
  closed: "Niedostępne lub zamknięte",
  private_or_unsafe: "Punkt na terenie prywatnym lub niebezpiecznym",
  wrong_location: "Zła lokalizacja na mapie",
  wrong_info: "Błąd w opisie, adresie lub dostępie",
  other: "Inne",
};

export const REPORT_STATUSES = ["open", "accepted", "rejected"] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REJECT_REASONS = [
  "duplicate",
  "not_accurate",
  "not_verifiable",
  "out_of_scope",
  "abuse",
  "other",
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_REASON_LABELS: Readonly<Record<RejectReason, string>> = {
  duplicate: "Zgłoszenie się powtarza",
  not_accurate: "Nie zgadza się ze stanem na miejscu",
  not_verifiable: "Nie da się tego sprawdzić",
  out_of_scope: "Nie dotyczy tej kolekcji",
  abuse: "Nadużycie",
  other: "Inny powód",
};

export const REPORT_ACTIONS = ["accept", "reject", "undo"] as const;

export type ReportAction = (typeof REPORT_ACTIONS)[number];

/** Which list of the queue: reports waiting for a decision, or the latest decisions. */
export const REPORT_QUEUE_STATES = ["open", "decided"] as const;

export type ReportQueueState = (typeof REPORT_QUEUE_STATES)[number];

/** The queue shows at most this many open reports (D-25); the counter counts all of them. */
export const MAX_OPEN_REPORTS_SHOWN = 200;
/** "Rozpatrzone" shows the latest decisions of the organization. */
export const MAX_DECIDED_REPORTS_SHOWN = 50;
export const DECISION_NOTE_MAX_LENGTH = 500;
/** The version column is a PostgreSQL integer; a larger number is a bad request, not a failure. */
export const MAX_REPORT_VERSION = 2_147_483_647;

/** Largest body of the decision route; bigger gets 413. */
export const DECISION_BODY_MAX_BYTES = 4 * 1024;

// Control characters other than a line feed, zero-width characters and the controls of the
// text direction: the same set as the CHECK of the migration (a text must not be made to look
// different to the curator). A NUL is added to the set of the CHECK: PostgreSQL cannot store it
// in a text at all, so it must be refused before the query (else it would be a failure, not a 422).
const FORBIDDEN_TEXT =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/u;

/** True when the text holds a character the CHECKs of the table refuse (after CRLF -> LF). */
export function hasForbiddenText(text: string): boolean {
  return FORBIDDEN_TEXT.test(text);
}

/** CRLF and lone CR become LF, so a form's line breaks count once. */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Length of a description as validation sees it: line breaks once, trimmed, in characters. */
export function countMessageCharacters(text: string): number {
  return [...normalizeLineBreaks(text).trim()].length;
}

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === "string" && (REPORT_CATEGORIES as readonly string[]).includes(value);
}

export function isRejectReason(value: unknown): value is RejectReason {
  return typeof value === "string" && (REJECT_REASONS as readonly string[]).includes(value);
}

export function isReportQueueState(value: unknown): value is ReportQueueState {
  return typeof value === "string" && (REPORT_QUEUE_STATES as readonly string[]).includes(value);
}

export type DecisionField = "action" | "reason" | "note" | "version";

export type ReportDecision = Readonly<{
  action: ReportAction;
  reason: RejectReason | null;
  note: string | null;
  version: number;
}>;

export type DecisionValidation =
  | Readonly<{ ok: true; value: ReportDecision }>
  | Readonly<{ ok: false; errors: readonly DecisionField[] }>;

// Validates the body of the decision route. `reason` is required to reject and ignored
// otherwise; an empty `note` is none; the note is plain text up to 500 characters.
export function validateDecisionInput(input: {
  action?: unknown;
  reason?: unknown;
  note?: unknown;
  version?: unknown;
}): DecisionValidation {
  const errors: DecisionField[] = [];
  const action = (REPORT_ACTIONS as readonly unknown[]).includes(input.action)
    ? (input.action as ReportAction)
    : null;

  if (action === null) {
    errors.push("action");
  }

  if (action === "reject" && !isRejectReason(input.reason)) {
    errors.push("reason");
  }

  let note: string | null = null;

  if (input.note !== undefined && input.note !== null) {
    const text = typeof input.note === "string" ? normalizeLineBreaks(input.note).trim() : null;

    if (text === null || [...text].length > DECISION_NOTE_MAX_LENGTH || FORBIDDEN_TEXT.test(text)) {
      errors.push("note");
    } else if (text !== "") {
      note = text;
    }
  }

  if (
    !Number.isSafeInteger(input.version) ||
    (input.version as number) < 1 ||
    (input.version as number) > MAX_REPORT_VERSION
  ) {
    errors.push("version");
  }

  if (action === null || errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      action,
      reason: action === "reject" ? (input.reason as RejectReason) : null,
      note: action === "undo" ? null : note,
      version: input.version as number,
    },
  };
}

/** The counter of the panel: "Zgłoszenia do sprawdzenia: 3"; nothing waiting is said plainly. */
export function formatOpenReportsCounter(count: number): string {
  return count === 0 ? "Zgłoszenia: nic nie czeka" : `Zgłoszenia do sprawdzenia: ${count}`;
}

/** The sentence above a queue longer than it shows; empty when everything is shown. */
export function formatQueueOverflow(total: number): string | null {
  return total > MAX_OPEN_REPORTS_SHOWN
    ? `Pokazano ${MAX_OPEN_REPORTS_SHOWN} najstarszych z ${total}. Rozpatrz je, a zobaczysz kolejne.`
    : null;
}
