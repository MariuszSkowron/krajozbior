"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Pozycja „Kolekcje” w menu panelu kuratora. Wszystkie ekrany panelu należą do kolekcji, więc
// pozycja jest bieżąca na całym `/curator`: `page` na samej liście, `true` na ekranach
// zagnieżdżonych (edycja kolekcji i miejsca), gdzie lista jest nadrzędną sekcją.
export function CuratorMenuLink({
  className,
  children,
}: Readonly<{ className: string; children: ReactNode }>) {
  const pathname = usePathname() ?? "";
  const current =
    pathname === "/curator" ? "page" : pathname.startsWith("/curator/") ? true : undefined;

  return (
    <Link className={className} href="/curator" aria-current={current}>
      {children}
    </Link>
  );
}
