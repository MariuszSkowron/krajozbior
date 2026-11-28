import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

// Cały dostęp do bazy akceptacji regulaminu. Każda metoda działa w kontekście użytkownika
// otwartym przez przypadek użycia, więc o widocznych wierszach decydują polityki; żadna
// metoda nie przyjmuje identyfikatora konta (właścicielem jest app_current_user_id() w SQL).
export interface TermsAcceptanceRepository {
  /** Czy konto aktora zaakceptowało podaną wersję regulaminu. */
  hasAccepted(tx: TransactionContext, version: string): Promise<boolean>;
  /** Czy konto aktora zaakceptowało jakąkolwiek wersję regulaminu. */
  hasAnyAcceptance(tx: TransactionContext): Promise<boolean>;
  /** Zapisuje akceptację podanej wersji; powtórna akceptacja tej samej wersji nic nie zmienia. */
  accept(tx: TransactionContext, version: string): Promise<void>;
}

export type TermsDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  repository: TermsAcceptanceRepository;
}>;

export type TermsOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "invalid" }>;
