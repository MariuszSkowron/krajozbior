import { Migration } from "@mikro-orm/migrations";

// E9-5, review fix m1: "the only member of an organization" (Q8) as a rule of the
// database, not only of the application.
//
// The use case asks `app_is_sole_organization_member()` in one transaction and
// deletes the account in another, so two last curators of a two-person
// organization deleting their accounts at the same time both passed the check
// and the organization was left without a member. The BEFORE DELETE trigger on
// auth.users closes that window: for every organization of the account it takes
// a transaction-scoped advisory lock on the organization (no table privilege is
// needed, and the second deletion waits until the first commits) and then
// refuses the deletion when nobody else is a member. READ COMMITTED gives the
// check after the lock a fresh snapshot, so the waiting deletion sees the
// first one's result. Locks are taken in the order of organization ids, so two
// deletions cannot deadlock.
//
// The function is `security definer` (owner krajozbior_owner, which has the
// SELECT policy `organization_members_function_select` since
// Migration20261118140000). Revoking a membership by the operator is not
// affected: the trigger fires only on deleting the account.

export class Migration20261118150000_last_member_guard extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create function auth_users_guard_last_member() returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        v_organization uuid;
      begin
        for v_organization in
          select m.organization_id
            from public.organization_members m
           where m.user_id = old.id
           order by m.organization_id
        loop
          perform pg_advisory_xact_lock(
            hashtextextended('organization_members:' || v_organization::text, 0));

          if not exists (
            select
              from public.organization_members other
             where other.organization_id = v_organization
               and other.user_id <> old.id
          ) then
            raise exception 'sole_organization_member';
          end if;
        end loop;

        return old;
      end
      $$;
    `);
    this.addSql(`revoke all on function auth_users_guard_last_member() from public;`);
    this.addSql(`
      create trigger auth_users_last_member_guarded before delete on auth.users
        for each row execute function auth_users_guard_last_member();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger auth_users_last_member_guarded on auth.users;`);
    this.addSql(`drop function auth_users_guard_last_member();`);
  }
}
