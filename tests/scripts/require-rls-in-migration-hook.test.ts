import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  findTablesWithoutRls,
  findWeakenedRls,
  SKILL_HINT,
} from "../../.claude/hooks/require-rls-in-migration.mjs";

// The Claude Code hook that refuses a migration creating a table without
// ENABLE + FORCE row level security (docs/data-isolation.md, sections 3 and 5).
// The process tests run the real script with a hook event on stdin, as Claude
// Code does: exit 2 blocks the tool call, exit 0 lets it through.
const script = fileURLToPath(
  new URL("../../.claude/hooks/require-rls-in-migration.mjs", import.meta.url),
);
const migrationsDir = fileURLToPath(new URL("../../src/lib/db/migrations/", import.meta.url));

const scratch = mkdtempSync(join(tmpdir(), "krajozbior-rls-hook-"));
const scratchMigrations = join(scratch, "src", "lib", "db", "migrations");
mkdirSync(scratchMigrations, { recursive: true });
const migrationPath = (name: string) => join(scratchMigrations, name);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function runHook(event: unknown) {
  const result = spawnSync(process.execPath, [script], {
    input: typeof event === "string" ? event : JSON.stringify(event),
    encoding: "utf8",
  });

  return { code: result.status, stderr: result.stderr };
}

const write = (filePath: string, content: string) =>
  runHook({ tool_name: "Write", tool_input: { file_path: filePath, content } });

const withHelper = `
  this.addSql(\`create table trip_notes (id uuid primary key, user_id uuid not null);\`);
  for (const s of privateTableSecuritySql("trip_notes", { operations: ["select"] })) this.addSql(s);
`;
const withoutRls = `this.addSql(\`create table trip_notes (id uuid primary key, user_id uuid not null);\`);`;

// Issue #205: most tests here start the hook as a separate Node process (a cold
// start each, two in one test); on a loaded machine that passes the default 5 s.
// The timeout is explicit for this file only, the assertions stay as they are.
describe("require-rls-in-migration hook", { timeout: 30_000 }, () => {
  it("lets through a new table secured with privateTableSecuritySql", () => {
    expect(write(migrationPath("Migration1_trip_notes.ts"), withHelper).code).toBe(0);
  });

  it("blocks a new table without row level security and names the table and the skill", () => {
    const { code, stderr } = write(migrationPath("Migration1_trip_notes.ts"), withoutRls);

    expect(code).toBe(2);
    expect(stderr).toContain("trip_notes");
    expect(stderr).toContain("skill private-data");
  });

  it("points to a skill file that exists in the repository", () => {
    const skill = fileURLToPath(
      new URL("../../.claude/skills/private-data/SKILL.md", import.meta.url),
    );

    expect(SKILL_HINT).toContain(".claude/skills/private-data/SKILL.md");
    expect(existsSync(skill)).toBe(true);
  });

  it.each([
    ['create table "Trip_Notes" (id int);', "trip_notes"],
    ['create table public."trip_notes" (id int);', "trip_notes"],
    ["create unlogged table trip_notes (id int);", "trip_notes"],
    ["create temp table trip_notes (id int);", "trip_notes"],
    ["create global temporary table trip_notes (id int);", "trip_notes"],
    ["create table if not exists app.trip_notes (id int);", "app.trip_notes"],
    ["create table trip_notes as select * from notes;", "trip_notes"],
    ["select * into trip_notes from notes;", "trip_notes"],
    ["select id, body into unlogged table trip_notes from notes;", "trip_notes"],
  ])("finds the new table in %s", (source, table) => {
    expect(findTablesWithoutRls(source)).toEqual([table]);
  });

  it("accepts quoted names with ENABLE + FORCE and does not mistake INSERT INTO for a new table", () => {
    expect(
      findTablesWithoutRls(`create table public."trip_notes" (id int);
        alter table if exists only "trip_notes" enable row level security;
        alter table public.trip_notes force row level security;
        insert into trip_notes (id) select id from other;`),
    ).toEqual([]);
  });

  it("blocks a migration that disables row level security or drops FORCE", () => {
    expect(findWeakenedRls("alter table trip_notes disable row level security;")).toEqual([
      "trip_notes",
    ]);
    expect(findWeakenedRls("alter table public.trip_notes no force row level security;")).toEqual([
      "trip_notes",
    ]);
    const source = `this.addSql(\`alter table trip_notes no force row level security;\`);`;
    expect(write(migrationPath("Migration3_trip_notes.ts"), source).code).toBe(2);
  });

  it("blocks ENABLE without FORCE: the table owner would skip the policies", () => {
    const source = `${withoutRls}\nthis.addSql(\`alter table trip_notes enable row level security;\`);`;

    expect(write(migrationPath("Migration1_trip_notes.ts"), source).code).toBe(2);
  });

  it("accepts literal ENABLE + FORCE and a loop over listed table names", () => {
    expect(
      findTablesWithoutRls(`create table a (id int); create table public.b (id int);
        alter table a enable row level security; alter table a force row level security;
        for (const t of ["b"]) { addSql(\`alter table \${t} enable row level security;\`);
                                 addSql(\`alter table \${t} force row level security;\`); }`),
    ).toEqual([]);
  });

  it("does not ask for RLS in the auth schema, where krajozbior_app has no privileges", () => {
    expect(findTablesWithoutRls("create table auth.sign_in_throttle (key text);")).toEqual([]);
  });

  it("ignores files outside src/lib/db/migrations", () => {
    expect(write(join(scratch, "notes.ts"), withoutRls).code).toBe(0);
  });

  it("checks the file as it will be after an Edit that removes FORCE", () => {
    const filePath = migrationPath("Migration2_trip_notes.ts");
    const force = `this.addSql(\`alter table trip_notes force row level security;\`);`;
    writeFileSync(
      filePath,
      `${withoutRls}\nthis.addSql(\`alter table trip_notes enable row level security;\`);\n${force}\n`,
    );

    const edit = (oldString: string, newString: string) =>
      runHook({
        tool_name: "Edit",
        tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
      });

    expect(edit(force, "// force later").code).toBe(2);
    expect(edit("uuid primary key", "uuid primary key default gen_random_uuid()").code).toBe(0);
  });

  it("does not count row security statements that sit in comments", () => {
    const create = "create table trip_notes (id int);";

    for (const commented of [
      `-- alter table trip_notes enable row level security;\n-- alter table trip_notes force row level security;`,
      `/* alter table trip_notes enable row level security;\n   alter table trip_notes force row level security; */`,
      `-- alter table trip_notes enable row level security;\nalter table trip_notes force row level security;`,
    ]) {
      expect(findTablesWithoutRls(`${create}\n${commented}`)).toEqual(["trip_notes"]);
    }
    expect(
      findTablesWithoutRls(
        `this.addSql(\`${create}\`);\n// this.addSql("alter table trip_notes enable row level security");\n// this.addSql("alter table trip_notes force row level security");`,
      ),
    ).toEqual(["trip_notes"]);
    expect(
      findTablesWithoutRls(
        `this.addSql(\`${create}\`);\n/* privateTableSecuritySql("trip_notes", {}) */`,
      ),
    ).toEqual(["trip_notes"]);
    expect(
      findTablesWithoutRls(
        `this.addSql(\`${create}\n  -- alter table trip_notes enable row level security;\n  /* alter table trip_notes force row level security; */\n\`);`,
      ),
    ).toEqual(["trip_notes"]);
  });

  it("ignores a table or a weakening that is only mentioned in a comment", () => {
    expect(findTablesWithoutRls("-- create table trip_notes (id int);")).toEqual([]);
    expect(findTablesWithoutRls("/* create table trip_notes (id int); */")).toEqual([]);
    expect(findTablesWithoutRls("// create table trip_notes (id int);")).toEqual([]);
    expect(findWeakenedRls("-- alter table trip_notes disable row level security;")).toEqual([]);
    // A comment line that merely starts with the words.
    expect(findTablesWithoutRls("-- create table for the notes\ncreate table a (id int);")).toEqual(
      ["a"],
    );
  });

  it("is not fooled into reading code as a comment", () => {
    const create = 'this.addSql("create table trip_notes (id int)");';

    // `i--` and `'a--b'` are not SQL comments; `//` in a string is not a JS comment.
    expect(findTablesWithoutRls(`for (let i = 3; i--; ) ${create}`)).toEqual(["trip_notes"]);
    expect(findTablesWithoutRls(`const s = "--"; ${create}`)).toEqual(["trip_notes"]);
    expect(
      findTablesWithoutRls(`this.addSql("select 'http://x'; create table trip_notes (id int)");`),
    ).toEqual(["trip_notes"]);
    // A block comment opened inside a line comment does not swallow real code.
    expect(findTablesWithoutRls(`// /*\n${create}\n// */`)).toEqual(["trip_notes"]);
    // Two separate strings do not form one block comment.
    expect(
      findTablesWithoutRls(`a("/*"); this.addSql("create table trip_notes (id int)"); b("*/");`),
    ).toEqual(["trip_notes"]);
    // A real comment before a template expression and an escaped quote keep working.
    expect(
      findTablesWithoutRls(
        "this.addSql(`create table trip_notes (id int); -- ${x}`); // note\nconst q = 'it\\'s';",
      ),
    ).toEqual(["trip_notes"]);
  });

  it.each(["Migration1_notes.js", "Migration1_notes.mjs", "Migration1_notes.cjs"])(
    "also checks a %s migration",
    (name) => {
      expect(write(migrationPath(name), withoutRls).code).toBe(2);
      expect(write(migrationPath(name), withHelper).code).toBe(0);
    },
  );

  it("does not block on a malformed event", () => {
    expect(runHook("not json").code).toBe(1);
  });

  it("raises no false alarm on any migration already in the repository", () => {
    const migrations = readdirSync(migrationsDir).filter((name) => name.endsWith(".ts"));

    expect(migrations.length).toBeGreaterThan(0);
    for (const name of migrations) {
      expect(findTablesWithoutRls(readFileSync(join(migrationsDir, name), "utf8")), name).toEqual(
        [],
      );
    }
  });
});
