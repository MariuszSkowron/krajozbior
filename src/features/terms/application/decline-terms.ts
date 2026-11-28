import type { Actor } from "@/features/identity/domain/actor";

// Odmowa akceptacji regulaminu (regulamin 1.1 rozdz. 4 ust. 2, polityka prywatności 1.1 §9):
// konto, które nigdy niczego nie zaakceptowało, usuwamy od razu razem z adresem e-mail.
// Przypadek użycia bierze aktora z sesji, nigdy identyfikatora konta, więc nie da się usunąć
// cudzego konta. Rola inna niż zwykły odkrywca (administrator) jest odrzucana tutaj, a konto
// z jakąkolwiek akceptacją albo z organizacją odrzuca baza (druga bariera): w obu przypadkach
// konto zostaje, a osoba jest tylko wylogowywana (konto, które przyjęło starszą wersję,
// wypowiada się przez usunięcie konta w ustawieniach, regulamin rozdz. 14 ust. 3).
export type DeclineTermsDeps = Readonly<{
  /** Usuwa konto o tym identyfikatorze, tylko gdy baza uzna je za porzucone; false = zostało. */
  deleteNeverAcceptedAccount: (accountId: string) => Promise<boolean>;
}>;

export type DeclineTermsOutcome = "unauthenticated" | "deleted" | "kept";

export async function declineTerms(
  actor: Actor | null,
  deps: DeclineTermsDeps,
): Promise<DeclineTermsOutcome> {
  if (actor === null) {
    return "unauthenticated";
  }

  if (actor.role !== "user") {
    return "kept";
  }

  return (await deps.deleteNeverAcceptedAccount(actor.id)) ? "deleted" : "kept";
}
