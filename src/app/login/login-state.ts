// Messages of the password form, by the error code the login route sends back.
const PASSWORD_ERRORS: Readonly<Record<string, string>> = {
  invalid_credentials: "Nieprawidłowy e-mail lub hasło.",
  unavailable: "Logowanie jest chwilowo niedostępne. Spróbuj ponownie.",
  too_many_attempts: "Zbyt wiele prób logowania. Spróbuj ponownie za kilka minut.",
};

// Messages of the e-mail code forms (routes under /api/auth/code).
const CODE_ERRORS: Readonly<Record<string, string>> = {
  invalid_email: "Podaj poprawny adres e-mail.",
  invalid_code: "Kod jest nieprawidłowy albo wygasł. Wyślij kod ponownie.",
  code_unavailable: "Logowanie kodem jest chwilowo niedostępne. Spróbuj ponownie.",
  code_too_many_attempts: "Zbyt wiele prób. Spróbuj ponownie za kilka minut.",
};

export function passwordMessage(errorCode: string | undefined): string | undefined {
  return errorCode !== undefined && Object.hasOwn(PASSWORD_ERRORS, errorCode)
    ? PASSWORD_ERRORS[errorCode]
    : undefined;
}

export function isCodeError(errorCode: string | undefined): errorCode is string {
  return errorCode !== undefined && Object.hasOwn(CODE_ERRORS, errorCode);
}

export function codeMessage(errorCode: string): string | undefined {
  return Object.hasOwn(CODE_ERRORS, errorCode) ? CODE_ERRORS[errorCode] : undefined;
}

// Only a wrong e-mail or password points at the fields; an outage or a rate
// limit is not something the person can fix in them.
export function marksFieldsInvalid(errorCode: string | undefined): boolean {
  return errorCode === "invalid_credentials";
}

// A page restored from the back/forward cache keeps its old script state,
// including a submit button that still waits for a response.
export function wasRestoredFromCache(event: { persisted: boolean }): boolean {
  return event.persisted;
}
