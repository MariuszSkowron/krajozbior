"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { isLegalPath } from "@/features/legal/domain/legal-pages";

import { TermsGate } from "./terms-gate";

// Strażnik akceptacji regulaminu w powłoce (F-K3, E11-Q4 A). Układ (layout.tsx) wstawia go
// tylko dla konta bez akceptacji, a decyzję „ekran czy strona” podejmuje tutaj, po stronie
// klienta: Next.js nie rysuje układu od nowa przy nawigacji `next/link`, ale ten komponent
// renderuje się przy każdej zmianie adresu, więc odnośnik ze strony prawnej (np. nazwa serwisu
// w nagłówku) nie ominie ekranu. Przy pierwszym wejściu działa tak samo na serwerze.
// Ekran nie jest granicą dostępu (docs/data-isolation.md): strona za nim nadal się renderuje
// i dotyczy tylko własnych danych konta; akceptacja to warunek umowny w interfejsie.
export function TermsGuard({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();

  if (isLegalPath(pathname)) {
    return children;
  }

  // O tym, czy ekran jest widoczny, decyduje sama ścieżka; parametr `zgoda` dokłada tylko
  // komunikat, więc nawet zawieszony odczyt zapytania pokazuje ekran, nigdy stronę.
  return (
    <Suspense fallback={<TermsGate path={pathname} problemCode={null} />}>
      <TermsGateWithProblem path={pathname} />
    </Suspense>
  );
}

function TermsGateWithProblem({ path }: Readonly<{ path: string }>) {
  return <TermsGate path={path} problemCode={useSearchParams().get("zgoda")} />;
}
