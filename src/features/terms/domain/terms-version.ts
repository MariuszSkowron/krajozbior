// Wersja regulaminu, którą odkrywca akceptuje na ekranie „Zanim zaczniesz” (E11-Q4 A).
// Zmiana tej wartości (nowy regulamin) sprawia, że każde konto zobaczy ekran akceptacji
// przy następnym wejściu. Musi zgadzać się z numerem wersji regulaminu na stronie
// `/regulamin` (test w tests/features/legal). Wersja 1.1 jest pierwszą obowiązującą.
export const CURRENT_TERMS_VERSION = "1.1";

// Data wejścia w życie bieżącej wersji, pokazywana przy polu akceptacji i na stronach prawnych.
export const TERMS_EFFECTIVE_DATE = "28 listopada 2026 r.";

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
