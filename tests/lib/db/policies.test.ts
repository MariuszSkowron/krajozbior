import { describe, expect, it } from "vitest";

import { privateTableSecuritySql } from "@/lib/db/policies";

describe("privateTableSecuritySql", () => {
  it("enables and forces RLS, grants only the listed operations and adds one policy each", () => {
    expect(
      privateTableSecuritySql("notes", { operations: ["select", "insert", "update"] }),
    ).toEqual([
      "alter table public.notes enable row level security;",
      "alter table public.notes force row level security;",
      "revoke all on public.notes from public;",
      "grant select, insert, update on public.notes to starter_app;",
      "create policy notes_owner_select on public.notes for select to starter_app using (user_id = (select app_current_user_id()));",
      "create policy notes_owner_insert on public.notes for insert to starter_app with check (user_id = (select app_current_user_id()));",
      "create policy notes_owner_update on public.notes for update to starter_app using (user_id = (select app_current_user_id())) with check (user_id = (select app_current_user_id()));",
    ]);
  });

  it("supports a schema-qualified table, another owner column and delete", () => {
    expect(
      privateTableSecuritySql("app.shared_notes", {
        userColumn: "owner_id",
        operations: ["delete"],
      }),
    ).toContain(
      "create policy shared_notes_owner_delete on app.shared_notes for delete to starter_app using (owner_id = (select app_current_user_id()));",
    );
  });

  it.each([
    ["notes; drop table x", { operations: ["select"] as const }],
    ["notes", { userColumn: "user_id or true", operations: ["select"] as const }],
    ["Notes", { operations: ["select"] as const }],
  ])("refuses an identifier that is not plain: %j", (table, options) => {
    expect(() => privateTableSecuritySql(table, options)).toThrow("Not a plain SQL identifier");
  });

  it("refuses a table with no operation for the application", () => {
    expect(() => privateTableSecuritySql("notes", { operations: [] })).toThrow(
      "A PRIV table needs at least one operation for starter_app",
    );
  });
});
