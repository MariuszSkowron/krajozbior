// Strony prawne w aplikacji (F-K3, spec E11, sekcja 5.9): cztery publiczne trasy bez logowania.
// Nazwy i adresy są w jednym miejscu, bo korzystają z nich stopka, ekran logowania, ekran
// „Zanim zaczniesz” i sama powłoka (strony prawne wolno czytać przed akceptacją regulaminu).

// Adresy ról w domenie serwisu (decyzja właściciela z 27.11.2026). Każdy temat ma własny adres;
// teksty prawne, stopka i wiadomości e-mail biorą je stąd, a nie z ręcznie wpisanych napisów.
export const CONTACT_ADDRESSES = {
  // Sprawy ogólne; punkt kontaktowy z art. 11 i 12 aktu o usługach cyfrowych (DSA).
  general: "kontakt@krajozbior.pl",
  // Treści bezprawne lub niezgodne z regulaminem (DSA art. 16), prawa autorskie, właściciel terenu.
  reports: "zgloszenia@krajozbior.pl",
  // Reklamacje i odwołania od decyzji w sprawie treści lub konta.
  complaints: "reklamacje@krajozbior.pl",
  // Sprawy danych osobowych (RODO).
  privacy: "prywatnosc@krajozbior.pl",
  // Zgłoszenia podatności.
  security: "bezpieczenstwo@krajozbior.pl",
  // Gminy, PTTK, organizacje turystyczne, kuratorzy, współpraca.
  partners: "partnerzy@krajozbior.pl",
} as const;

export const CONTACT_EMAIL = CONTACT_ADDRESSES.general;

export const LEGAL_PAGES = [
  { slug: "regulamin", path: "/regulamin", title: "Regulamin" },
  { slug: "polityka-prywatnosci", path: "/polityka-prywatnosci", title: "Polityka prywatności" },
  { slug: "zasady", path: "/zasady", title: "Najważniejsze zasady" },
  {
    slug: "oswiadczenie-o-zdjeciach",
    path: "/oswiadczenie-o-zdjeciach",
    title: "Oświadczenie o prawach do zdjęcia i licencja (załącznik nr 1)",
  },
  {
    slug: "umowa-powierzenia",
    path: "/umowa-powierzenia",
    title: "Umowa powierzenia przetwarzania danych osobowych (załącznik nr 2)",
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
