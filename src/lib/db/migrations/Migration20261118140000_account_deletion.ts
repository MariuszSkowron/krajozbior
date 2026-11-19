import { Migration } from "@mikro-orm/migrations";

// E9-5, account deletion (D-31 pt 2-3, D-E9-3, Q8, Q9).
//
// 1. `delete_account` joins the operations in the audit CHECK (frozen list).
// 2. The entry for a deleted account is written by the database, as a result of
//    the deletion itself: an AFTER DELETE row trigger on auth.users calls
//    `auth_users_audit_deletion()` (security definer, owner krajozbior_owner,
//    the migration role). The identity role krajozbior_auth gets no grant and no
//    policy on the audit; the entry cannot exist without the deletion, and the
//    deletion cannot happen without the entry (an error in the trigger rolls the
//    deletion back).
// 3. The owner needs one narrow INSERT policy because the audit has FORCE ROW
//    LEVEL SECURITY: only `delete_account`, only `applied`, with no organization
//    and no states. This is the single exception to "the owner does not write
//    the audit" (Migration20261118120000); the owner still has no UPDATE/DELETE
//    policy and the append-only trigger still binds it.
// 4. The guard `operations_audit_delete_account_guard` (BEFORE INSERT) refuses a
//    `delete_account` entry (55000) unless the account is really gone: it also
//    refuses an empty `subject_user_id` (V2), a rejected outcome, an
//    organization, states or an error code. A BEFORE trigger runs before the
//    WITH CHECK of the policy, so these cases fail with 55000; the policy is the
//    second layer, confirmed in the catalog by a test (V1).
// 5. `operations_audit_ops_insert` is narrowed to `operation <> 'delete_account'`,
//    so the operator cannot write such an entry by hand.
// 6. `app_is_sole_organization_member()`: true when the current user (the actor
//    of the user context) is the only member of some organization. Through row
//    security krajozbior_app sees only its own memberships, so counting other
//    members needs this one function, which returns a boolean and nothing else
//    (Q8, variant B). The owner gets a SELECT policy on `organization_members`
//    for it.
//
// Residual risk (D-21 pt 1, V3): `TRUNCATE auth.users` does not fire row
// triggers; krajozbior_auth has no TRUNCATE privilege there (a test checks it),
// only the table owner can.

const frozenOperations = `'grant_curator', 'revoke_curator', 'set_organization_status', 'set_user_role'`;
const operationsWithDeletion = `${frozenOperations}, 'delete_account'`;
// Unicode category Cc, the same pattern as the audit CHECKs (no line breaks or
// terminal escapes in the audit).
const controlCharacters = String.raw`'[\u0001-\u001f\u007f-\u009f]'`;

export class Migration20261118140000_account_deletion extends Migration {
  override async up(): Promise<void> {
    // 1. The new operation.
    this.addSql(`alter table operations_audit drop constraint operations_audit_operation_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_operation_check
        check (operation in (${operationsWithDeletion}));
    `);

    // 2. The writing function and its trigger.
    this.addSql(`
      create function auth_users_audit_deletion() returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        v_declared text := nullif(current_setting('krajozbior.operator_label', true), '');
        v_label text;
      begin
        -- The identity role always writes "self-service": it cannot name itself
        -- anything else. A deletion by someone else (the operator removing an
        -- administrator, Q8) may declare a label with
        -- \`set local krajozbior.operator_label = '...'\` (D-21 pt 2, V4); an
        -- unusable label (empty, over 80 characters, control characters) falls
        -- back to the name of the connected role, so it never breaks the deletion.
        if session_user = 'krajozbior_auth' then
          v_label := 'self-service';
        elsif v_declared is not null
              and char_length(v_declared) <= 80
              and v_declared !~ ${controlCharacters} then
          v_label := v_declared;
        else
          v_label := session_user::text;
        end if;

        insert into public.operations_audit
          (operation, operator_label, subject_user_id, outcome, reason)
        values ('delete_account', v_label, old.id, 'applied', 'account deleted');

        return null;
      end
      $$;
    `);
    this.addSql(`revoke all on function auth_users_audit_deletion() from public;`);
    this.addSql(`
      create trigger auth_users_deletion_audited after delete on auth.users
        for each row execute function auth_users_audit_deletion();
    `);

    // 3. The narrow policy of the owner (the function runs as the owner).
    this.addSql(`
      create policy operations_audit_account_deletion_insert on operations_audit
        for insert to krajozbior_owner
        with check (
          operation = 'delete_account'
          and outcome = 'applied'
          and organization_id is null
          and before_state is null
          and after_state is null
        );
    `);

    // 4. The guard.
    this.addSql(`
      create function operations_audit_delete_account_guard() returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      begin
        if new.subject_user_id is null
           or new.outcome <> 'applied'
           or new.organization_id is not null
           or new.before_state is not null
           or new.after_state is not null
           or new.error_code is not null
           or exists (select from auth.users u where u.id = new.subject_user_id)
        then
          raise exception 'a delete_account entry is written only by the deletion of the account'
            using errcode = '55000';
        end if;

        return new;
      end
      $$;
    `);
    this.addSql(`revoke all on function operations_audit_delete_account_guard() from public;`);
    this.addSql(`
      create trigger operations_audit_delete_account_guard before insert on operations_audit
        for each row when (new.operation = 'delete_account')
        execute function operations_audit_delete_account_guard();
    `);

    // 5. The operator cannot write the entry by hand.
    this.addSql(`drop policy operations_audit_ops_insert on operations_audit;`);
    this.addSql(`
      create policy operations_audit_ops_insert on operations_audit
        for insert to krajozbior_ops with check (operation <> 'delete_account');
    `);

    // 6. "Am I the only member of an organization" (Q8).
    this.addSql(`
      create policy organization_members_function_select on organization_members
        for select to krajozbior_owner using (true);
    `);
    this.addSql(`
      create function app_is_sole_organization_member() returns boolean
      language sql stable security definer
      set search_path = ''
      as $$
        select exists (
          select
            from public.organization_members m
           where m.user_id = public.app_current_user_id()
             and not exists (
               select
                 from public.organization_members other
                where other.organization_id = m.organization_id
                  and other.user_id <> m.user_id
             )
        )
      $$;
    `);
    this.addSql(`revoke all on function app_is_sole_organization_member() from public;`);
    this.addSql(`grant execute on function app_is_sole_organization_member() to krajozbior_app;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop function app_is_sole_organization_member();`);
    this.addSql(`drop policy organization_members_function_select on organization_members;`);

    this.addSql(`drop policy operations_audit_ops_insert on operations_audit;`);
    this.addSql(`
      create policy operations_audit_ops_insert on operations_audit
        for insert to krajozbior_ops with check (true);
    `);

    this.addSql(`drop trigger operations_audit_delete_account_guard on operations_audit;`);
    this.addSql(`drop function operations_audit_delete_account_guard();`);
    this.addSql(`drop policy operations_audit_account_deletion_insert on operations_audit;`);
    this.addSql(`drop trigger auth_users_deletion_audited on auth.users;`);
    this.addSql(`drop function auth_users_audit_deletion();`);

    // The append-only trigger blocks DELETE, so `delete_account` entries stay and
    // the previous CHECK is restored NOT VALID (a validated one would fail on
    // them), as in Migration20261118120000.
    this.addSql(`alter table operations_audit drop constraint operations_audit_operation_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_operation_check
        check (operation in (${frozenOperations})) not valid;
    `);
  }
}
