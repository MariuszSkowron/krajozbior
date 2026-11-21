import "server-only";

import { parseTheme } from "../domain/theme";
import type { SettingsRepository } from "../application/settings-types";

// Raw SQL on the transaction of the use case (user context). No statement takes
// a user id: the owner of the row is the default of `user_id`
// (app_current_user_id()), and the row policies of `account_settings` (owner
// only) decide what is read or written. `on conflict (user_id)` can only meet the
// actor's own row: a row of somebody else is invisible to the policies.

export const postgresSettingsRepository: SettingsRepository = {
  async readTheme(tx) {
    const rows = await tx.em.execute<{ theme: string }[]>(
      `select theme from public.account_settings where user_id = app_current_user_id()`,
    );

    // The CHECK keeps the stored value on the list; an unknown one is a defect, not a theme.
    return parseTheme(rows[0]?.theme);
  },

  async saveTheme(tx, theme) {
    // A write that changes nothing is skipped (the toggle may be pressed often).
    await tx.em.execute(
      `insert into public.account_settings (theme) values (?)
       on conflict (user_id) do update
         set theme = excluded.theme, updated_at = now()
         where public.account_settings.theme is distinct from excluded.theme`,
      [theme],
    );
  },
};
