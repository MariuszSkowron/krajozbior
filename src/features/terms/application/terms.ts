import type { Actor } from "@/features/identity/domain/actor";

import { CURRENT_TERMS_VERSION, isAcceptanceGiven } from "../domain/terms-version";
import type { TermsDeps, TermsOutcome } from "./terms-types";

// Akceptacja regulaminu (F-K3, E11-Q4 A). Każdy przypadek użycia bierze aktora z sesji,
// nigdy identyfikatora konta: właścicielem wiersza jest app_current_user_id() w bazie,
// a polityki wierszy są drugą barierą. Gość dostaje `unauthenticated` przed czymkolwiek innym.
// Rola nie ma znaczenia: ekran przechodzi też administrator (E11-Q4 A, punkt 6).

/** Czy konto aktora zaakceptowało bieżącą wersję regulaminu. */
export async function hasAcceptedCurrentTerms(
  actor: Actor | null,
  deps: TermsDeps,
): Promise<TermsOutcome<boolean>> {
  if (actor === null) {
    return { status: "unauthenticated" };
  }

  return deps.withUserContext(actor, async (tx) => ({
    status: "ok",
    value: await deps.repository.hasAccepted(tx, CURRENT_TERMS_VERSION),
  }));
}

/**
 * Czy konto aktora zaakceptowało kiedykolwiek jakąkolwiek wersję regulaminu. Ekran „Zanim
 * zaczniesz” używa tego do treści przycisku odmowy: konto bez żadnej akceptacji usuwamy, a konto
 * ze starszą akceptacją tylko wylogowujemy.
 */
export async function hasEverAcceptedTerms(
  actor: Actor | null,
  deps: TermsDeps,
): Promise<TermsOutcome<boolean>> {
  if (actor === null) {
    return { status: "unauthenticated" };
  }

  return deps.withUserContext(actor, async (tx) => ({
    status: "ok",
    value: await deps.repository.hasAnyAcceptance(tx),
  }));
}

/**
 * Zapisuje akceptację bieżącej wersji regulaminu przez aktora. Wersji nie podaje wywołujący:
 * konto akceptuje to, co serwis pokazał jako bieżące. Brak zaznaczonego pola to `invalid`
 * i nic nie trafia do bazy.
 */
export async function acceptCurrentTerms(
  actor: Actor | null,
  accepted: unknown,
  deps: TermsDeps,
): Promise<TermsOutcome<null>> {
  if (actor === null) {
    return { status: "unauthenticated" };
  }

  if (!isAcceptanceGiven(accepted)) {
    return { status: "invalid" };
  }

  return deps.withUserContext(actor, async (tx) => {
    await deps.repository.accept(tx, CURRENT_TERMS_VERSION);

    return { status: "ok", value: null };
  });
}
