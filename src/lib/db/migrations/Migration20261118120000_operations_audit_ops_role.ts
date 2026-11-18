import { Migration } from "@mikro-orm/migrations";

// The operator commands move from krajozbior_owner to krajozbior_ops (D-20 pt 2,
// D-21). The append-only trigger and FORCE row security bind every role except
// the table owner, who can switch both off. The role that writes the operations
// audit must therefore not own it: krajozbior_owner is the migration role and
// no longer writes `organizations`, `organization_members` or the audit.
//
// - krajozbior_ops: `insert` into the audit only on the content columns (the
//   database fills `occurred_at`, `recorded_by` and `transaction_id`), `select`
//   of `id` alone (for `insert ... returning id`), no UPDATE/DELETE/TRUNCATE.
//   Organizations: `select`, `insert`, `update (status)`; members: `select`,
//   `insert`, `delete`.
// - Two narrow `security definer` functions reach `auth.users` for the role:
//   `ops_find_user` (one row for an exact e-mail) and `ops_set_user_role`
//   (changes only `role`). They do not write the audit: the writer stays ops.
// - Two triggers on `auth.users` reject a role change (and an insert with a
//   role other than `user`) unless the same transaction holds a matching
//   `set_user_role` entry. The role of an account therefore never changes
//   without a trace. The table owner can still disable them: residual risk,
//   accepted in D-21 pt 1 (the migration password stays off the application
//   server).

const frozenOperations = `'grant_curator', 'revoke_curator', 'set_organization_status'`;
const operationsWithRole = `${frozenOperations}, 'set_user_role'`;
const auditInsertColumns =
  "operation, operator_label, subject_user_id, organization_id, outcome, before_state, after_state, reason, error_code";

export class Migration20261118120000_operations_audit_ops_role extends Migration {
  override async up(): Promise<void> {
    // 1. Audit columns filled by the database, and the new operation.
    this.addSql(`alter table operations_audit add column recorded_by text null;`);
    this.addSql(`alter table operations_audit add column transaction_id xid8 null;`);
    // Existing rows keep null (history is not guessed); the defaults apply to
    // new rows only, and the CHECK is NOT VALID for the same reason.
    this.addSql(`alter table operations_audit alter column recorded_by set default session_user;`);
    this.addSql(
      `alter table operations_audit alter column transaction_id set default pg_current_xact_id();`,
    );
    this.addSql(`
      alter table operations_audit add constraint operations_audit_recorded_check
        check (recorded_by is not null and transaction_id is not null) not valid;
    `);
    this.addSql(`alter table operations_audit drop constraint operations_audit_operation_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_operation_check
        check (operation in (${operationsWithRole}));
    `);

    // 2. The owner stops writing; krajozbior_ops takes over.
    for (const policy of [
      "organizations_operator_select",
      "organizations_operator_insert",
      "organizations_operator_update",
    ]) {
      this.addSql(`drop policy ${policy} on organizations;`);
    }
    for (const policy of [
      "organization_members_operator_select",
      "organization_members_operator_insert",
      "organization_members_operator_delete",
    ]) {
      this.addSql(`drop policy ${policy} on organization_members;`);
    }
    this.addSql(`drop policy operations_audit_operator_insert on operations_audit;`);

    // The owner still reads approved organizations (policies and functions
    // that run as the owner, such as record_on_site_visit) and the audit (the
    // role-change trigger below). Those functions filter `status` themselves.
    this.addSql(`
      create policy organizations_function_select on organizations
        for select to krajozbior_owner using (status = 'approved');
    `);

    this.addSql(`grant select, insert on organizations to krajozbior_ops;`);
    this.addSql(`grant update (status) on organizations to krajozbior_ops;`);
    this.addSql(`grant select, insert, delete on organization_members to krajozbior_ops;`);
    this.addSql(`grant select (id) on operations_audit to krajozbior_ops;`);
    this.addSql(`grant insert (${auditInsertColumns}) on operations_audit to krajozbior_ops;`);

    this.addSql(`
      create policy organizations_ops_select on organizations
        for select to krajozbior_ops using (true);
    `);
    this.addSql(`
      create policy organizations_ops_insert on organizations
        for insert to krajozbior_ops with check (true);
    `);
    this.addSql(`
      create policy organizations_ops_update on organizations
        for update to krajozbior_ops using (true) with check (true);
    `);
    this.addSql(`
      create policy organization_members_ops_select on organization_members
        for select to krajozbior_ops using (true);
    `);
    this.addSql(`
      create policy organization_members_ops_insert on organization_members
        for insert to krajozbior_ops with check (true);
    `);
    this.addSql(`
      create policy organization_members_ops_delete on organization_members
        for delete to krajozbior_ops using (true);
    `);
    this.addSql(`
      create policy operations_audit_ops_select on operations_audit
        for select to krajozbior_ops using (true);
    `);
    this.addSql(`
      create policy operations_audit_ops_insert on operations_audit
        for insert to krajozbior_ops with check (true);
    `);

    // 3. Functions on auth.users (owner = krajozbior_owner, the migration role).
    this.addSql(`
      create function ops_find_user(p_email text) returns table (user_id uuid, role text)
      language sql stable security definer
      set search_path = ''
      as $$
        select u.id, u.role from auth.users u where u.email = lower(btrim(p_email))
      $$;
    `);
    this.addSql(`
      create function ops_set_user_role(p_user_id uuid, p_role text) returns text
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        v_previous text;
      begin
        v_previous := (select u.role from auth.users u where u.id = p_user_id for update);
        if v_previous is null then
          raise exception 'account not found' using errcode = 'P0002';
        end if;
        update auth.users set role = p_role, updated_at = now() where id = p_user_id;
        return v_previous;
      end
      $$;
    `);
    this.addSql(`
      create function auth_users_require_role_audit() returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      begin
        if not exists (
          select from public.operations_audit a
           where a.operation = 'set_user_role'
             and a.outcome = 'applied'
             and a.subject_user_id = new.id
             and a.after_state ->> 'role' = new.role
             and a.transaction_id = pg_current_xact_id()
        ) then
          raise exception 'a role change needs a set_user_role entry in operations_audit'
            using errcode = '55000';
        end if;

        return null;
      end
      $$;
    `);
    for (const signature of [
      "ops_find_user(text)",
      "ops_set_user_role(uuid, text)",
      "auth_users_require_role_audit()",
    ]) {
      this.addSql(`revoke all on function ${signature} from public;`);
    }
    this.addSql(`grant execute on function ops_find_user(text) to krajozbior_ops;`);
    this.addSql(`grant execute on function ops_set_user_role(uuid, text) to krajozbior_ops;`);

    // Two triggers: a WHEN clause of an INSERT trigger cannot reference OLD.
    this.addSql(`
      create trigger auth_users_role_audited_insert after insert on auth.users
        for each row when (new.role <> 'user')
        execute function auth_users_require_role_audit();
    `);
    this.addSql(`
      create trigger auth_users_role_audited_update after update of role on auth.users
        for each row when (old.role is distinct from new.role)
        execute function auth_users_require_role_audit();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger auth_users_role_audited_update on auth.users;`);
    this.addSql(`drop trigger auth_users_role_audited_insert on auth.users;`);
    this.addSql(`drop function auth_users_require_role_audit();`);
    this.addSql(`drop function ops_set_user_role(uuid, text);`);
    this.addSql(`drop function ops_find_user(text);`);

    for (const [table, policy] of [
      ["organizations", "organizations_ops_select"],
      ["organizations", "organizations_ops_insert"],
      ["organizations", "organizations_ops_update"],
      ["organization_members", "organization_members_ops_select"],
      ["organization_members", "organization_members_ops_insert"],
      ["organization_members", "organization_members_ops_delete"],
      ["operations_audit", "operations_audit_ops_select"],
      ["operations_audit", "operations_audit_ops_insert"],
    ]) {
      this.addSql(`drop policy ${policy} on ${table};`);
    }
    // Table-level REVOKE also removes the column privileges.
    this.addSql(
      `revoke all on organizations, organization_members, operations_audit from krajozbior_ops;`,
    );

    this.addSql(`drop policy organizations_function_select on organizations;`);
    this.addSql(`
      create policy organizations_operator_select on organizations
        for select to krajozbior_owner using (true);
    `);
    this.addSql(`
      create policy organizations_operator_insert on organizations
        for insert to krajozbior_owner with check (true);
    `);
    this.addSql(`
      create policy organizations_operator_update on organizations
        for update to krajozbior_owner using (true) with check (true);
    `);
    this.addSql(`
      create policy organization_members_operator_select on organization_members
        for select to krajozbior_owner using (true);
    `);
    this.addSql(`
      create policy organization_members_operator_insert on organization_members
        for insert to krajozbior_owner with check (true);
    `);
    this.addSql(`
      create policy organization_members_operator_delete on organization_members
        for delete to krajozbior_owner using (true);
    `);
    this.addSql(`
      create policy operations_audit_operator_insert on operations_audit
        for insert to krajozbior_owner with check (true);
    `);

    // The append-only trigger blocks DELETE, so set_user_role entries stay and
    // the old CHECK is restored NOT VALID: a validated one would fail on them.
    // It therefore stays unvalidated until a later up() replaces it.
    this.addSql(`alter table operations_audit drop constraint operations_audit_operation_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_operation_check
        check (operation in (${frozenOperations})) not valid;
    `);
    this.addSql(`alter table operations_audit drop constraint operations_audit_recorded_check;`);
    this.addSql(`alter table operations_audit drop column transaction_id;`);
    this.addSql(`alter table operations_audit drop column recorded_by;`);
  }
}
