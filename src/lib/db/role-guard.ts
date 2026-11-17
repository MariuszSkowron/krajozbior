// Raised when a runtime connection (krajozbior_app or krajozbior_auth) reaches a role
// that could skip row policies (issues #42, #44), e.g. an old local `.env`
// with the administrator. The message names the reason only, never the
// connection string or the role's password.
export class UnsafeDatabaseRoleError extends Error {
  constructor() {
    super("Database role must not be privileged, own objects, belong to roles or switch roles");
    this.name = "UnsafeDatabaseRoleError";
  }
}

export type RoleFlags = {
  switched: boolean;
  privileged: boolean;
  owner: boolean;
  member: boolean;
};

// session_user differs after SET ROLE from a privileged login; an owner can
// turn FORCE ROW LEVEL SECURITY off; a member can SET ROLE to what it belongs
// to (NOINHERIT does not prevent that).
export const unsafeRoleQuery = `select session_user <> current_user as switched,
       r.rolsuper or r.rolbypassrls as privileged,
       exists (select from pg_class c where c.relowner = r.oid)
         or exists (select from pg_namespace n where n.nspowner = r.oid) as owner,
       exists (select from pg_auth_members m where m.member = r.oid) as member
  from pg_roles r
 where r.rolname = current_user`;

// Fails closed: a missing row or any flag that is not exactly false refuses.
export async function assertSafeDatabaseRole(
  queryOne: (sql: string) => Promise<Partial<RoleFlags> | undefined>,
): Promise<void> {
  const flags = await queryOne(unsafeRoleQuery);
  const safe =
    flags !== undefined &&
    flags.switched === false &&
    flags.privileged === false &&
    flags.owner === false &&
    flags.member === false;

  if (!safe) {
    throw new UnsafeDatabaseRoleError();
  }
}
