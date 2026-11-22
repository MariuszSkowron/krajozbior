import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runNewsImport } from "@/features/news/application/news-import-command";
import { connectNewsImport } from "@/features/news/infrastructure/postgres-news-import-runner";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// `news:import` on the real database (E7-R2a, spec E7 sections 14.3, 14.4, 14.6). The command
// runs as krajozbior_ops: a preview writes nothing, a write puts the whole file in one
// transaction together with the entries `news_import` of the operations audit, an error
// anywhere leaves nothing and one `rejected` entry, a repeat of the same file changes nothing.
const POLISH = "ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ";
const REASON = "Publikacja aktualnosci z pliku aktualnosci-test.ndjson";

let db: ScratchDatabase;
let editorialId = "";

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

type Item = Partial<{
  id: string;
  kind: string;
  title: string;
  lead: string;
  body: string;
  place_id: string | null;
  event_starts_on: string | null;
  status: string;
}>;

const item = (overrides: Item = {}) => ({
  id: randomUUID(),
  kind: "guide",
  title: "Aktualność redakcji",
  lead: "Krótki opis aktualności.",
  body: "Treść zwykłym tekstem.",
  status: "published",
  ...overrides,
});

const file = (...items: Record<string, unknown>[]) =>
  `${items.map((entry) => JSON.stringify(entry)).join("\n")}\n`;

type Env = { NODE_ENV?: string; DATABASE_OPS_URL?: string; host: string | undefined };

// The command with the real runner, as `scripts/news-import.ts` wires it.
const command = (
  argv: string[],
  content: string,
  options: { url?: string; env?: Partial<Env>; beforeWrite?: () => Promise<void> } = {},
) =>
  runNewsImport(argv, {
    // As the script reads the flag itself.
    confirmedHost: argv[argv.indexOf("--confirm-host") + 1],
    readFile: async () => content,
    connect: () =>
      connectNewsImport(options.url ?? db.urls.krajozbior_ops, {
        ...(options.beforeWrite === undefined ? {} : { beforeWrite: options.beforeWrite }),
      }),
    env: {
      NODE_ENV: "development",
      DATABASE_OPS_URL: db.urls.krajozbior_ops,
      host: "krajozbior.pl",
      ...options.env,
    },
    defaultOperator: "test",
  });

const preview = (content: string) => command(["--dry-run", "--file", "x"], content);
const apply = (content: string, extra: string[] = []) =>
  command(["--file", "x", "--operator", "wlasciciel", "--reason", REASON, ...extra], content);
const summary = (stdout: readonly string[]) => JSON.parse(stdout.at(-1)!);

type Row = {
  id: string;
  slug: string;
  title: string;
  status: string;
  version: number;
  withdrawn_at: Date | null;
};

const rowsOf = (ids: string[]) =>
  admin$<Row>(
    `select id, slug, title, status, version, withdrawn_at from public.news_posts
      where id = any($1::uuid[]) order by array_position($1::uuid[], id)`,
    [ids],
  );

type AuditRow = {
  outcome: string;
  error_code: string | null;
  recorded_by: string;
  transaction_id: string;
  operator_label: string;
  reason: string;
  organization_id: string;
  subject_user_id: string | null;
  details: unknown;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown>;
};

const auditOf = (ids: string[]) =>
  admin$<AuditRow>(
    `select outcome, error_code, recorded_by, transaction_id::text as transaction_id, operator_label,
            reason, organization_id, subject_user_id, details, before_state, after_state
       from public.operations_audit
      where operation = 'news_import' and after_state->>'id' = any($1::text[])
      order by occurred_at, array_position($1::text[], after_state->>'id')`,
    [ids],
  );

const countNews = async () =>
  Number((await admin$<{ n: string }>(`select count(*) as n from public.news_posts`))[0]!.n);

describe("news:import (E7-R2a)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_news_import");
    await db.migrate();
    editorialId = (
      await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind)
         values ('Krajozbiór — redakcja', 'krajozbior-redakcja', 'other') returning id`,
      )
    )[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("a preview shows the states and writes nothing: no news, no audit entry", async () => {
    const a = item({ title: "Podglad pierwszy" });
    const b = item({ title: "Podglad drugi", status: "draft" });
    const before = await countNews();
    const result = await preview(file(a, b));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.slice(0, 2)).toEqual(["nowa | Podglad pierwszy", "nowa | Podglad drugi"]);
    expect(summary(result.stdout)).toEqual({
      outcome: "preview",
      lines: 2,
      states: { created: 2, updated: 0, unchanged: 0, withdrawn: 0 },
    });
    expect(await countNews()).toBe(before);
    expect(await auditOf([a.id, b.id])).toEqual([]);
  });

  it("writes the whole file with the Polish letters intact and one audit entry per item in one transaction", async () => {
    const a = item({ title: `Zażółć gęślą jaźń ${POLISH}`, body: `Treść: ${POLISH}.` });
    const b = item({
      title: "Wydarzenie testowe",
      kind: "event",
      event_starts_on: "2026-12-05",
      status: "draft",
    });
    const result = await apply(file(a, b));

    expect(result.exitCode).toBe(0);
    expect(result.stdout[0]).toBe(`nowa | ${a.title}`);
    expect(summary(result.stdout)).toEqual({
      outcome: "applied",
      lines: 2,
      results: { created: 2, updated: 0, unchanged: 0, withdrawn: 0 },
    });

    const [first, second] = await rowsOf([a.id, b.id]);

    expect(first).toMatchObject({
      title: a.title,
      status: "published",
      slug: "zazolc-gesla-jazn-acelnoszz-acelnoszz",
    });
    expect(second).toMatchObject({ status: "draft", slug: "wydarzenie-testowe" });

    const body = await admin$<{ body: string }>(
      `select body from public.news_posts where id = $1`,
      [a.id],
    );

    expect(body[0]!.body).toBe(`Treść: ${POLISH}.`);

    const entries = await auditOf([a.id, b.id]);

    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.outcome === "applied" && e.error_code === null)).toBe(true);
    expect(entries.every((e) => e.recorded_by === "krajozbior_ops")).toBe(true);
    // The same transaction for the whole file.
    expect(new Set(entries.map((e) => e.transaction_id)).size).toBe(1);
    expect(entries[0]).toMatchObject({
      operator_label: "wlasciciel",
      reason: REASON,
      organization_id: editorialId,
      subject_user_id: null,
      details: null,
      before_state: null,
    });
    expect(entries[0]!.after_state).toMatchObject({ id: a.id, status: "published" });
    // S1: the target holds no text of the news.
    expect(JSON.stringify(entries)).not.toContain("jaźń");
  });

  it("an error in one line saves nothing and leaves one rejected entry", async () => {
    const ok = item({ title: "Pierwsza dobra linia" });
    const bad = item({ title: "Nowa wycofana", status: "withdrawn" });
    const before = await countNews();
    const result = await apply(file(ok, bad));

    expect(result.exitCode).toBe(3);
    expect(summary(result.stdout)).toEqual({
      outcome: "rejected",
      code: "invalid_transition",
      line: 2,
    });
    expect(await countNews()).toBe(before);
    expect(await rowsOf([ok.id, bad.id])).toEqual([]);

    const entries = await auditOf([ok.id, bad.id]);

    // No `applied` entry of the first line survived the rollback.
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      outcome: "rejected",
      error_code: "invalid_transition",
      recorded_by: "krajozbior_ops",
      organization_id: editorialId,
      reason: REASON,
    });
    expect(entries[0]!.after_state).toEqual({ id: bad.id, line: 2 });
  });

  it("a preview reports the same refusal without any entry", async () => {
    const bad = item({ title: "Podglad wycofanej", status: "withdrawn" });
    const result = await preview(file(item({ title: "Dobra w podgladzie" }), bad));

    expect(result.exitCode).toBe(3);
    expect(summary(result.stdout)).toMatchObject({ outcome: "rejected", line: 2 });
    expect(await auditOf([bad.id])).toEqual([]);
  });

  it("the same file again changes nothing: no new version, no new entry", async () => {
    const a = item({ title: "Powtorne wgranie" });
    const content = file(a);

    await apply(content);

    const [before] = await rowsOf([a.id]);
    const again = await apply(content);

    expect(again.exitCode).toBe(0);
    expect(summary(again.stdout).results).toEqual({
      created: 0,
      updated: 0,
      unchanged: 1,
      withdrawn: 0,
    });
    expect(again.stdout[0]).toBe("bez zmian | Powtorne wgranie");
    expect((await rowsOf([a.id]))[0]).toEqual(before);
    expect(await auditOf([a.id])).toHaveLength(1);
  });

  it("changes an item, keeps its address after a new title and withdraws it by the file", async () => {
    const a = item({ title: "Pierwotny tytul wpisu" });

    await apply(file(a));

    const [created] = await rowsOf([a.id]);
    const edited = await apply(file({ ...a, title: "Zmieniony tytul wpisu" }));

    expect(summary(edited.stdout).results).toMatchObject({ updated: 1 });

    const [updated] = await rowsOf([a.id]);

    expect(updated).toMatchObject({ title: "Zmieniony tytul wpisu", version: 2 });
    expect(updated!.slug).toBe(created!.slug);

    const withdrawn = await apply(
      file({ ...a, title: "Zmieniony tytul wpisu", status: "withdrawn" }),
    );

    expect(withdrawn.stdout[0]).toBe("wycofana | Zmieniony tytul wpisu");
    expect(summary(withdrawn.stdout).results).toMatchObject({ withdrawn: 1, updated: 0 });

    const [gone] = await rowsOf([a.id]);

    expect(gone!.status).toBe("withdrawn");
    expect(gone!.withdrawn_at).not.toBeNull();
    expect(gone!.slug).toBe(created!.slug);

    const entries = await auditOf([a.id]);

    expect(entries.map((e) => e.outcome)).toEqual(["applied", "applied", "applied"]);
    expect(entries[2]!.before_state).toMatchObject({ status: "published" });
    expect(entries[2]!.after_state).toMatchObject({ status: "withdrawn" });

    // A withdrawn item may be published again, but never goes back to a draft.
    const back = await apply(file({ ...a, title: "Zmieniony tytul wpisu", status: "draft" }));

    expect(summary(back.stdout)).toMatchObject({ outcome: "rejected", code: "invalid_transition" });
  });

  it("gives a second item with the same title the next free address", async () => {
    const a = item({ title: "Ten sam tytul" });
    const b = item({ title: "Ten sam tytul" });

    await apply(file(a, b));

    const [first, second] = await rowsOf([a.id, b.id]);

    expect(first!.slug).toBe("ten-sam-tytul");
    expect(second!.slug).toBe("ten-sam-tytul-2");
  });

  it("turns an address taken in parallel into a refusal with a clear code (S6)", async () => {
    const a = item({ title: "Wyscig o adres" });
    const result = await command(
      ["--file", "x", "--operator", "wlasciciel", "--reason", REASON],
      file(a),
      {
        // Between the read of the taken addresses and the write another run takes the address.
        beforeWrite: async () => {
          await withClient(db.urls.krajozbior_ops, (client) =>
            client.query(
              `select public.ops_put_news($1, $2, 'wyscig-o-adres', 'guide', 'Zajmuje adres',
                      'Opis.', '', null, null, null, null, 'published')`,
              [randomUUID(), editorialId],
            ),
          );
        },
      },
    );

    expect(result.exitCode).toBe(3);
    expect(summary(result.stdout)).toEqual({ outcome: "rejected", code: "slug_taken", line: 1 });
    expect(await rowsOf([a.id])).toEqual([]);

    const entries = await auditOf([a.id]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ outcome: "rejected", error_code: "import_refused" });
  });

  it("refuses an organization that does not exist in the database", async () => {
    const connection = await connectNewsImport(db.urls.krajozbior_ops);

    try {
      const outcome = await connection.run({
        entries: [],
        orgSlug: "nie-ma-takiej",
        preview: false,
        operator: "x",
        reason: REASON,
      });

      expect(outcome).toEqual({ kind: "refused", code: "organization_not_found" });
    } finally {
      await connection.close();
    }
  });

  it("refuses an organization outside the editorial list before any connection", async () => {
    const result = await command(
      ["--dry-run", "--file", "x", "--org-slug", "gmina-a"],
      file(item()),
    );

    expect(result.exitCode).toBe(3);
    expect(summary(result.stdout)).toMatchObject({ code: "organization_not_allowed" });
  });

  it("refuses the application role and the owner: the write needs krajozbior_ops", async () => {
    const a = item({ title: "Odmowa dla roli aplikacji" });

    for (const role of ["krajozbior_app", "krajozbior_owner"] as const) {
      const result = await command(
        ["--file", "x", "--operator", "x", "--reason", REASON],
        file(a),
        { url: db.urls[role] },
      );

      // Not a refusal of the domain: a failure of the connection (exit 1, no JSON).
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toEqual([]);
      expect(result.stderr.join("\n")).toContain("klasa 42");
    }

    expect(await rowsOf([a.id])).toEqual([]);
    expect(await auditOf([a.id])).toEqual([]);
  });

  it("refuses production without --target server, and on the server needs the confirmed host", async () => {
    const a = item({ title: "Odmowa w produkcji" });
    const production = await command(
      ["--file", "x", "--operator", "x", "--reason", REASON],
      file(a),
      { env: { NODE_ENV: "production" } },
    );
    const wrongHost = await command(
      [
        "--file",
        "x",
        "--operator",
        "x",
        "--reason",
        REASON,
        "--target",
        "server",
        "--confirm-host",
        "inny.pl",
      ],
      file(a),
      { env: { NODE_ENV: "production" } },
    );

    expect(summary(production.stdout)).toEqual({ outcome: "refused", code: "production" });
    expect(summary(wrongHost.stdout)).toEqual({ outcome: "refused", code: "host_mismatch" });
    expect(await rowsOf([a.id])).toEqual([]);

    const server = await command(
      [
        "--file",
        "x",
        "--operator",
        "wlasciciel",
        "--reason",
        REASON,
        "--target",
        "server",
        "--confirm-host",
        "krajozbior.pl",
      ],
      file(a),
      { env: { NODE_ENV: "production" } },
    );

    expect(server.exitCode).toBe(0);
    expect(await rowsOf([a.id])).toHaveLength(1);
  });

  it("answers an error of the file with exit 2 before any write", async () => {
    const before = await countNews();
    const result = await apply(`${JSON.stringify(item({ title: "Dobra" }))}\n{zle\n`);

    expect(result.exitCode).toBe(2);
    expect(summary(result.stdout)).toMatchObject({ outcome: "invalid" });
    expect(await countNews()).toBe(before);
  });

  it("refuses the 201st news item of the organization and rolls the file back (D-28)", async () => {
    const present = await countNews();
    const items = Array.from({ length: 200 - present + 1 }, (_, n) =>
      item({ title: `Limit organizacji ${n}` }),
    );
    // The file may hold at most 200 items; the limit counts what is in the database.
    const result = await apply(file(...items));

    expect(result.exitCode).toBe(3);
    expect(summary(result.stdout)).toMatchObject({ outcome: "rejected", code: "too_many_news" });
    expect(await countNews()).toBe(present);
  });
});
