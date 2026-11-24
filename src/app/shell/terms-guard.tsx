"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import type { HomeBannerPick } from "@/features/catalog/application/catalog-types";
import {
  FIRST_SIGN_IN_FROM_LOGIN,
  FIRST_SIGN_IN_PARAM,
} from "@/features/identity/domain/login-entry";
import { isLegalPath } from "@/features/legal/domain/legal-pages";

import { TermsGate } from "./terms-gate";

// Strażnik akceptacji regulaminu w powłoce (F-K3, E11-Q4 A). Układ (layout.tsx) wstawia go
// tylko dla konta bez akceptacji, a decyzję „ekran czy strona” podejmuje tutaj, po stronie
// klienta: Next.js nie rysuje układu od nowa przy nawigacji `next/link`, ale ten komponent
// renderuje się przy każdej zmianie adresu, więc odnośnik ze strony prawnej (np. nazwa serwisu
// w nagłówku) nie ominie ekranu. Przy pierwszym wejściu działa tak samo na serwerze.
// Ekran nie jest granicą dostępu (docs/data-isolation.md): strona za nim nadal się renderuje
// i dotyczy tylko własnych danych konta; akceptacja to warunek umowny w interfejsie.
export function TermsGuard({
  children,
  photo = null,
}: Readonly<{ children: ReactNode; photo?: HomeBannerPick | null }>) {
  const pathname = usePathname();

  if (isLegalPath(pathname)) {
    return children;
  }

  // O tym, czy ekran jest widoczny, decyduje sama ścieżka; parametry `zgoda` i `wejscie` dokładają
  // tylko komunikaty, więc nawet zawieszony odczyt zapytania pokazuje ekran, nigdy stronę.
  return (
    <Suspense fallback={<TermsGate path={pathname} problemCode={null} photo={photo} />}>
      <TermsGateWithProblem path={pathname} photo={photo} />
    </Suspense>
  );
}

function TermsGateWithProblem({
  path,
  photo,
}: Readonly<{ path: string; photo: HomeBannerPick | null }>) {
  const params = useSearchParams();

  return (
    <TermsGate
      path={path}
      problemCode={params.get("zgoda")}
      photo={photo}
      firstSignIn={params.get(FIRST_SIGN_IN_PARAM) === FIRST_SIGN_IN_FROM_LOGIN}
    />
  );
}
