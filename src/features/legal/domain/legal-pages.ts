// Strony prawne w aplikacji (F-K3, spec E11, sekcja 5.9): cztery publiczne trasy bez logowania.
// Nazwy i adresy są w jednym miejscu, bo korzystają z nich stopka, ekran logowania, ekran
// „Zanim zaczniesz” i sama powłoka (strony prawne wolno czytać przed akceptacją regulaminu).

export const CONTACT_EMAIL = "kontakt@mariuszskowron.pl";

export const LEGAL_PAGES = [
  { slug: "regulamin", path: "/regulamin", title: "Regulamin" },
  { slug: "polityka-prywatnosci", path: "/polityka-prywatnosci", title: "Polityka prywatności" },
  { slug: "zasady", path: "/zasady", title: "Najważniejsze zasady" },
  {
    slug: "oswiadczenie-o-zdjeciach",
    path: "/oswiadczenie-o-zdjeciach",
    title: "Oświadczenie o zdjęciach",
  },
] as const;

export type LegalSlug = (typeof LEGAL_PAGES)[number]["slug"];

export function legalPage(slug: LegalSlug) {
  return LEGAL_PAGES.find((page) => page.slug === slug)!;
}

// Czy adres (ścieżka z ewentualnym zapytaniem) wskazuje stronę prawną. Ukośnik na końcu
// nie zmienia strony; inna wielkość liter albo dopisek to już inna trasa.
export function isLegalPath(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");

  return LEGAL_PAGES.some((page) => page.path === path);
}
