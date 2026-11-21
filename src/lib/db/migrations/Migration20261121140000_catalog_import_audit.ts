import { Migration } from "@mikro-orm/migrations";

// F-K6 (E11, spec 5.6): the loader `catalog:import --target server` leaves a
// trace in the operations audit.
//
// 1. `catalog_import` and `catalog_remove` join the operations in the audit
//    CHECK (frozen list, with `delete_account` from Migration20261118140000).
// 2. `import_refused` and `import_failed` join the error codes: a result entry
//    of a refused or failed load is `rejected` like every other refusal.
// 3. `details jsonb`: the batch (identifier, SHA-256 of the file, counts). Only
//    for the two new operations, only an object, at most 4000 characters (the
//    audit cannot be edited, so it stays small and carries no personal data;
//    the loader writes no e-mails or titles there).
// 4. krajozbior_ops gets INSERT of that single column. Row security, the
//    policies, the append-only triggers and the other grants stay as they are:
//    no UPDATE, no DELETE, and krajozbior_app and krajozbior_owner still have
//    no way to write the audit.
//
// Order: after Migration20261121100000_terms_acceptance (F-K3).

const previousOperations = `'grant_curator', 'revoke_curator', 'set_organization_status', 'set_user_role', 'delete_account'`;
const operations = `${previousOperations}, 'catalog_import', 'catalog_remove'`;
const previousErrorCodes = `'user_not_found', 'organization_not_found', 'kind_mismatch', 'person_member_limit', 'organization_details_required'`;
const errorCodes = `${previousErrorCodes}, 'import_refused', 'import_failed'`;

export class Migration20261121140000_catalog_import_audit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table operations_audit drop constraint operations_audit_operation_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_operation_check
        check (operation in (${operations}));
    `);
    this.addSql(`alter table operations_audit drop constraint operations_audit_error_code_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_error_code_check
        check (error_code in (${errorCodes}));
    `);

    this.addSql(`alter table operations_audit add column details jsonb null;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_details_check
        check (
          details is null
          or (
            jsonb_typeof(details) = 'object'
            and operation in ('catalog_import', 'catalog_remove')
            and char_length(details::text) <= 4000
          )
        );
    `);

    this.addSql(`grant insert (details) on operations_audit to krajozbior_ops;`);
  }

  override async down(): Promise<void> {
    // The append-only trigger blocks DELETE, so the new entries stay and the
    // previous CHECKs are restored NOT VALID (validated ones would fail on
    // them), as in Migration20261118140000.
    this.addSql(`alter table operations_audit drop constraint operations_audit_details_check;`);
    this.addSql(`alter table operations_audit drop column details;`);

    this.addSql(`alter table operations_audit drop constraint operations_audit_error_code_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_error_code_check
        check (error_code in (${previousErrorCodes})) not valid;
    `);
    this.addSql(`alter table operations_audit drop constraint operations_audit_operation_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_operation_check
        check (operation in (${previousOperations})) not valid;
    `);
  }
}
