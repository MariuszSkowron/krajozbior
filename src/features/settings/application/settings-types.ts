import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import type { Theme } from "../domain/theme";

// All database access of the account settings. Every method runs inside the user
// context the use case opened, so the row policies decide what it sees or
// changes; no method takes a user id (the owner is app_current_user_id() in SQL).
export interface SettingsRepository {
  /** The actor's own theme, or `null` when the account never chose one. */
  readTheme(tx: TransactionContext): Promise<Theme | null>;
  /** Stores the actor's own theme (creates the row on the first choice). */
  saveTheme(tx: TransactionContext, theme: Theme): Promise<void>;
}

export type SettingsDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  repository: SettingsRepository;
}>;

// The answer of every use case; the caller maps it to what the person sees.
export type SettingsOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "invalid" }>;
