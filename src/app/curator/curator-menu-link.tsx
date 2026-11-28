"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const REPORTS = "/curator/reports";

// Pozycja menu panelu kuratora: „Kolekcje” (`/curator`) i „Zgłoszenia” (`/curator/reports`). Ekrany
// kolekcji (lista, edycja kolekcji i miejsca) należą do pozycji „Kolekcje”, ekrany zgłoszeń do
// „Zgłoszeń”. Pozycja jest bieżąca: `page` na samym swoim ekranie, `true` na ekranach zagnieżdżonych,
// gdzie jest nadrzędną sekcją.
export function CuratorMenuLink({
  className,
  href = "/curator",
  children,
}: Readonly<{ className: string; href?: "/curator" | typeof REPORTS; children: ReactNode }>) {
  const pathname = usePathname() ?? "";
  const inReports = pathname === REPORTS || pathname.startsWith(`${REPORTS}/`);
  const own = href === REPORTS ? inReports : pathname.startsWith("/curator") && !inReports;
  const current = !own ? undefined : pathname === href ? "page" : true;

  return (
    <Link className={className} href={href} aria-current={current}>
      {children}
    </Link>
  );
}
