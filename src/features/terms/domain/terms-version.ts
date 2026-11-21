// Wersja regulaminu, którą odkrywca akceptuje na ekranie „Zanim zaczniesz” (E11-Q4 A).
// Zmiana tej wartości (nowy regulamin po opinii prawnika, F-P5) sprawia, że każde konto
// zobaczy ekran akceptacji przy następnym wejściu. Musi zgadzać się z numerem wersji
// regulaminu na stronie `/regulamin` (test w tests/features/legal).
export const CURRENT_TERMS_VERSION = "0.2";

// Data wersji roboczej, pokazywana przy polu akceptacji i na stronach prawnych.
export const TERMS_DRAFT_DATE = "19 listopada 2026 r.";

// Kształt numeru wersji: cyfry rozdzielone kropkami (CHECK w tabeli `terms_acceptance`).
const VERSION_SHAPE = /^[0-9]+(\.[0-9]+){0,3}$/;

export function isTermsVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_SHAPE.test(value);
}

// Pole wyboru na ekranie akceptacji: zaznaczone pole natywnego formularza przychodzi jako
// „on” (przeglądarka) albo „true” (żądanie JSON); każda inna wartość to brak akceptacji.
export function isAcceptanceGiven(value: unknown): boolean {
  return value === "on" || value === "true" || value === true;
}
