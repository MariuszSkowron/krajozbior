import { Migration } from "@mikro-orm/migrations";

// Konta bez akceptacji regulaminu (polityka prywatności 1.1 §3 i §9, regulamin rozdz. 4 ust. 2,
// rejestr C1a): odmowa akceptacji usuwa konto od razu, a porzucone zakładanie konta znika po
// 7 dniach. Kasuje istniejąca ścieżka usuwania konta (`deleteAccountRows`, role krajozbior_auth,
// kaskada i wpis dziennika z wyzwalacza z E9-5); ta migracja dodaje tylko pytanie „czy to konto
// jest porzucone”, bo krajozbior_auth nie widzi tabeli `terms_acceptance`.
//
// `auth_account_is_abandoned(id, min_age)` zwraca true tylko dla konta, które jednocześnie:
//   - ma rolę `user` (nigdy administrator),
//   - nie należy do żadnej organizacji (nigdy kurator),
//   - nigdy nie zaakceptowało żadnej wersji regulaminu,
//   - jest starsze niż `min_age` (przy odmowie 0).
// To druga bariera obok sprawdzenia roli w przypadku użycia. Funkcja zwraca wartość logiczną,
// nigdy wiersze; wykonuje ją tylko krajozbior_auth.
//
// `terms_acceptance` ma FORCE ROW LEVEL SECURITY, a test dostępu pilnuje, że krajozbior_owner nie
// widzi tam żadnego wiersza. Dlatego polityka właściciela działa tylko wewnątrz tej funkcji:
// funkcja ustawia na czas transakcji znacznik `krajozbior.terms_probe`, a polityka wymaga tego
// znacznika oraz zalogowanej roli krajozbior_auth (`session_user`, wzorzec z news_posts), bo
// znacznik z kropką może ustawić każda rola. Poza funkcją właściciel nadal nie widzi niczego. Wiersze organizacji czyta istniejąca
// polityka `organization_members_function_select` (Migration20261118140000).
export class Migration20261128110000_abandoned_accounts extends Migration {
  override name = "Migration20261128110000_abandoned_accounts";

  override async up(): Promise<void> {
    this.addSql(`
      create policy terms_acceptance_abandoned_probe_select on public.terms_acceptance
        for select to krajozbior_owner
        using (
          session_user = 'krajozbior_auth'
          and current_setting('krajozbior.terms_probe', true) = 'on'
        );
    `);
    this.addSql(`
      create function auth_account_is_abandoned(p_user_id uuid, p_min_age interval)
      returns boolean
      language plpgsql volatile security definer
      set search_path = ''
      as $$
      declare
        v_abandoned boolean;
      begin
        perform set_config('krajozbior.terms_probe', 'on', true);

        select exists (
          select
            from auth.users u
           where u.id = p_user_id
             and u.role = 'user'
             and u.created_at <= now() - p_min_age
             and not exists (select from public.terms_acceptance t where t.user_id = u.id)
             and not exists (select from public.organization_members m where m.user_id = u.id)
        ) into v_abandoned;

        perform set_config('krajozbior.terms_probe', '', true);

        return v_abandoned;
      end
      $$;
    `);
    this.addSql(`revoke all on function auth_account_is_abandoned(uuid, interval) from public;`);
    this.addSql(
      `grant execute on function auth_account_is_abandoned(uuid, interval) to krajozbior_auth;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop function auth_account_is_abandoned(uuid, interval);`);
    this.addSql(`drop policy terms_acceptance_abandoned_probe_select on public.terms_acceptance;`);
  }
}
