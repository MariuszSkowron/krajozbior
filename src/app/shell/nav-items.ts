// Pozycje głównej nawigacji zalogowanego odkrywcy (E3-S2, Q7): tylko istniejące ekrany.
// Aktualności dochodzą razem ze swoim ekranem (E7); Profil to ekran „Profil” (E9-1).
export type NavIconName = "home" | "cards" | "bookmark" | "profile";

export type NavItem = Readonly<{ href: string; label: string; icon: NavIconName }>;

export const navItems: readonly NavItem[] = [
  { href: "/", label: "Start", icon: "home" },
  { href: "/my/collections", label: "Moje kolekcje", icon: "cards" },
  { href: "/my/want-to-see", label: "Chcę zobaczyć", icon: "bookmark" },
  { href: "/my", label: "Profil", icon: "profile" },
];

const within = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/**
 * Adres pozycji, która jest bieżąca na danej trasie, albo null (np. strona logowania).
 * Katalog publiczny (strona startowa, kolekcja, miejsce) należy do „Start”.
 */
export function activeNavHref(pathname: string): string | null {
  if (within(pathname, "/my/collections")) return "/my/collections";
  if (within(pathname, "/my/want-to-see")) return "/my/want-to-see";
  if (pathname === "/my") return "/my";
  if (pathname === "/" || within(pathname, "/collections") || within(pathname, "/places")) {
    return "/";
  }
  return null;
}

/** Panel kuratora ma własne menu, więc menu boczne powłoki na komputerze ustępuje. */
export function isCuratorPath(pathname: string): boolean {
  return within(pathname, "/curator");
}
