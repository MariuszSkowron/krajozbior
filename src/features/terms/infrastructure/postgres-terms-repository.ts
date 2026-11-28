import "server-only";

import type { TermsAcceptanceRepository } from "../application/terms-types";

// Czysty SQL na transakcji przypadku użycia (kontekst użytkownika). Żadna instrukcja nie
// podaje identyfikatora konta: właścicielem wiersza jest wartość domyślna `user_id`
// (app_current_user_id()), a polityki `terms_acceptance` (tylko właściciel) decydują,
// co jest widoczne. `on conflict do nothing` zbiega się tylko z własnym wierszem konta.
export const postgresTermsRepository: TermsAcceptanceRepository = {
  async hasAccepted(tx, version) {
    const rows = await tx.em.execute<{ accepted: boolean }[]>(
      `select exists (
         select 1 from public.terms_acceptance
          where user_id = app_current_user_id() and terms_version = ?
       ) as accepted`,
      [version],
    );

    return rows[0]?.accepted === true;
  },

  async hasAnyAcceptance(tx) {
    const rows = await tx.em.execute<{ accepted: boolean }[]>(
      `select exists (
         select 1 from public.terms_acceptance where user_id = app_current_user_id()
       ) as accepted`,
    );

    return rows[0]?.accepted === true;
  },

  async accept(tx, version) {
    await tx.em.execute(
      `insert into public.terms_acceptance (terms_version) values (?)
       on conflict (user_id, terms_version) do nothing`,
      [version],
    );
  },
};
