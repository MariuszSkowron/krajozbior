// Row security for a PRIV table: rows that belong to one user and are visible
// only to that user (issue #21, docs/data-isolation.md section 5). The owner of
// the table calls this in the same migration that creates it, so the table
// never exists without its policies. CUR tables (proposals and their history)
// need named transition functions and are not covered by this helper.
export type PrivateTableOperation = "select" | "insert" | "update" | "delete";

export type PrivateTableOptions = {
  /** Column holding the owning user's id (uuid). */
  userColumn?: string;
  /** Operations krajozbior_app may run; anything else is not granted at all. */
  operations: readonly PrivateTableOperation[];
};

const identifier = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(value: string): string {
  if (!identifier.test(value)) {
    throw new Error(`Not a plain SQL identifier: ${value}`);
  }

  return value;
}

export function privateTableSecuritySql(
  table: string,
  { userColumn = "user_id", operations }: PrivateTableOptions,
): string[] {
  const [schema, name] = table.includes(".") ? table.split(".", 2) : ["public", table];
  const qualified = `${assertIdentifier(schema)}.${assertIdentifier(name)}`;
  const isOwner = `${assertIdentifier(userColumn)} = (select app_current_user_id())`;

  if (operations.length === 0) {
    throw new Error("A PRIV table needs at least one operation for krajozbior_app");
  }

  const policy = (operation: PrivateTableOperation) => {
    const create = `create policy ${name}_owner_${operation} on ${qualified} for ${operation} to krajozbior_app`;

    switch (operation) {
      case "insert":
        return `${create} with check (${isOwner});`;
      case "update":
        // Both clauses: the row must be the actor's before and after the change.
        return `${create} using (${isOwner}) with check (${isOwner});`;
      default:
        return `${create} using (${isOwner});`;
    }
  };

  return [
    `alter table ${qualified} enable row level security;`,
    // FORCE: the table owner is bound by the policies too.
    `alter table ${qualified} force row level security;`,
    `revoke all on ${qualified} from public;`,
    `grant ${operations.join(", ")} on ${qualified} to krajozbior_app;`,
    ...operations.map(policy),
  ];
}
