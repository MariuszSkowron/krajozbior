import type { Actor } from "@/features/identity/domain/actor";

import { parseTheme, type Theme } from "../domain/theme";
import type { SettingsDeps, SettingsOutcome } from "./settings-types";

// Settings remembered on the account (E9-4). Every use case takes the actor from
// the session and never a user id: the owner of the row is app_current_user_id()
// in the database, and the row policies are the second barrier. A guest gets
// `unauthenticated` before anything else happens.

/** The actor's own theme; `null` value when the account never chose one. */
export async function getMyTheme(
  actor: Actor | null,
  deps: SettingsDeps,
): Promise<SettingsOutcome<Theme | null>> {
  if (actor === null) {
    return { status: "unauthenticated" };
  }

  return deps.withUserContext(actor, async (tx) => ({
    status: "ok",
    value: await deps.repository.readTheme(tx),
  }));
}

/** Stores the actor's own theme. A value outside the list never reaches the database. */
export async function saveMyTheme(
  actor: Actor | null,
  value: unknown,
  deps: SettingsDeps,
): Promise<SettingsOutcome<Theme>> {
  if (actor === null) {
    return { status: "unauthenticated" };
  }

  const theme = parseTheme(value);

  if (theme === null) {
    return { status: "invalid" };
  }

  return deps.withUserContext(actor, async (tx) => {
    await deps.repository.saveTheme(tx, theme);

    return { status: "ok", value: theme };
  });
}
