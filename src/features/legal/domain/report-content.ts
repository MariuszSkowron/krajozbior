// Zgłoszenie treści bezprawnej e-mailem (E5-0, regulamin rozdz. 8 ust. 1): do czasu formularza
// (E5-6) odnośnik „Zgłoś naruszenie” otwiera program pocztowy z gotowym tematem i treścią. Adres
// zgłaszanej strony trafia do wiadomości, żeby zgłoszenie wskazywało treść. Nie ma tu żadnych
// danych osobowych: imię, nazwisko i adres e-mail zgłaszający wpisuje sam w programie pocztowym.

import { CONTACT_ADDRESSES } from "./legal-pages";

export type ReportTarget = Readonly<{
  // Adres zgłaszanej strony: ścieżka (`/places/…`) albo pełny adres. Zapytanie i fragment
  // zostają obcięte, bo mogą nieść informacje poza treścią (np. adres powrotu po logowaniu).
  path: string;
  // Czytelna nazwa treści (np. nazwa miejsca); bez niej w temacie jest sam adres.
  title?: string;
}>;

const MAX_SUBJECT_TARGET = 80;

function cleanPath(path: string): string {
  return path.split(/[?#]/, 1)[0]!;
}

function cleanTitle(title: string | undefined): string {
  return (title ?? "").trim();
}

export function reportContentSubject(target: ReportTarget): string {
  const label = cleanTitle(target.title) || cleanPath(target.path);
  const short =
    label.length > MAX_SUBJECT_TARGET ? `${label.slice(0, MAX_SUBJECT_TARGET)}…` : label;

  return `Zgłoszenie treści: ${short}`;
}

export function reportContentBody(url: string, title?: string): string {
  const name = cleanTitle(title);

  return [
    "Dzień dobry,",
    "",
    "zgłaszam treść, którą uważam za bezprawną albo niezgodną z regulaminem.",
    "",
    `1. Wskazanie treści: ${url}${name === "" ? "" : ` (${name})`}`,
    "   Opis treści (np. którego zdjęcia lub fragmentu dotyczy zgłoszenie):",
    "",
    "2. Dlaczego treść jest bezprawna albo niezgodna z regulaminem:",
    "",
    "3. Imię i nazwisko oraz adres e-mail zgłaszającego (pomiń je przy zgłoszeniu przestępstw z art. 3–7 dyrektywy 2011/93/UE):",
    "",
    "4. Oświadczam, że działam w dobrej wierze, a informacje w zgłoszeniu są prawdziwe i kompletne.",
  ].join("\r\n");
}

// `origin` to adres serwisu (np. `https://krajozbior.pl`); pusty, gdy nieznany (render po stronie
// serwera): wtedy w wiadomości jest sama ścieżka, która też wskazuje stronę.
export function reportContentMailto(target: ReportTarget, origin: string): string {
  const path = cleanPath(target.path);
  const url = /^https?:\/\//.test(path) ? path : `${origin}${path}`;
  const subject = encodeURIComponent(reportContentSubject(target));
  const body = encodeURIComponent(reportContentBody(url, target.title));

  return `mailto:${CONTACT_ADDRESSES.reports}?subject=${subject}&body=${body}`;
}
