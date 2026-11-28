import { REPORT_MESSAGE_MAX_LENGTH } from "./limits";
import {
  hasForbiddenText,
  isReportCategory,
  normalizeLineBreaks,
  type ReportCategory,
} from "./report";

// What an explorer sends to report a problem with a place (P4b, PR B). The place comes from the
// address of the route and the author from the session, never from the body.

/** The kinds of problem whose description is mandatory (the other kinds explain themselves). */
const TEXT_REQUIRED: readonly ReportCategory[] = ["other", "wrong_info"];

export function isTextRequired(category: ReportCategory): boolean {
  return TEXT_REQUIRED.includes(category);
}

export type SubmitField = "category" | "message";

export type ReportSubmission = Readonly<{ category: ReportCategory; message: string }>;

export type SubmitValidation =
  | Readonly<{ ok: true; value: ReportSubmission }>
  | Readonly<{ ok: false; errors: readonly SubmitField[] }>;

// Validates the body. A missing description is empty text; the length counts characters of the
// text with CRLF turned into LF, like the CHECK of the table (which counts characters, not bytes).
export function validateSubmitInput(input: {
  category?: unknown;
  message?: unknown;
}): SubmitValidation {
  const errors: SubmitField[] = [];
  const category = isReportCategory(input.category) ? input.category : null;

  if (category === null) {
    errors.push("category");
  }

  let message = "";

  if (input.message !== undefined && input.message !== null) {
    if (typeof input.message !== "string") {
      errors.push("message");
    } else {
      message = normalizeLineBreaks(input.message).trim();

      if ([...message].length > REPORT_MESSAGE_MAX_LENGTH || hasForbiddenText(message)) {
        errors.push("message");
      }
    }
  }

  if (category !== null && isTextRequired(category) && message === "" && errors.length === 0) {
    errors.push("message");
  }

  if (category === null || errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { category, message } };
}
