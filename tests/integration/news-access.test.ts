import { randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOrmConfig } from "@/lib/db/config";
import { writeAuditEntry } from "@/lib/db/operations-audit";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// News of the editorial version (E7-R1, spec E7 section 14.3), on the real database.
// Nobody writes `news_posts` directly: krajozbior_app and krajozbior_ops read only,
// the one writer is `ops_put_news` (security definer, EXECUTE for krajozbior_ops).
// `app` is a pooled connection with one connection (a leaked context would show);
// the superuser connection only prepares rows and reads the truth back.
const noPermission = /permission denied/;
const writeRefused = /permission denied|read-only transaction/;
const rejectedByPolicy = /row-level security/;

let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("cur-a");
const explorer = user("explorer");

let orgA = ""; // the editorial organization, approved
let orgB = ""; // approved, another one
let orgS = ""; // suspended

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const ops$ = (sql: string, params: unknown[] = []) =>
  withClient(db.urls.krajozbior_ops, (client) => client.query(sql, params));
const as$ = (role: "krajozbior_owner" | "krajozbior_auth", sql: string, params: unknown[] = []) =>
  withClient(db.urls[role], (client) => client.query(sql, params));

const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
  runInUserContext(app.em, actor, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));
const asGuest = (sql: string, params: unknown[] = []) =>
  runInGuestContext(app.em, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));

let counter = 0;
const next = () => (counter += 1);

type Put = {
  id: string;
  organizationId: string;
  slug: string | null;
  kind: string;
  title: string;
  lead: string;
  body: string;
  collectionId: string | null;
  placeId: string | null;
  eventStartsOn: string | null;
  eventEndsOn: string | null;
  status: string;
};

const newPut = (overrides: Partial<Put> = {}): Put => ({
  id: randomUUID(),
  organizationId: orgA,
  slug: `aktualnosc-${next()}`,
  kind: "guide",
  title: "Tytuł aktualności",
  lead: "Krótki opis aktualności.",
  body: "",
  collectionId: null,
  placeId: null,
  eventStartsOn: null,
  eventEndsOn: null,
  status: "draft",
  ...overrides,
});

type PutResult = { put_result: string; put_before: unknown; put_after: Record<string, unknown> };

const putSql = `select put_result, put_before, put_after
  from public.ops_put_news($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
const putParams = (v: Put) => [
  v.id,
  v.organizationId,
  v.slug,
  v.kind,
  v.title,
  v.lead,
  v.body,
  v.collectionId,
  v.placeId,
  v.eventStartsOn,
  v.eventEndsOn,
  v.status,
];

// One call of the function as krajozbior_ops, in its own transaction.
const put = async (v: Put): Promise<PutResult> =>
  (await ops$(putSql, putParams(v))).rows[0] as PutResult;
const putIn = async (client: Client, v: Put): Promise<PutResult> =>
  (await client.query(putSql, putParams(v))).rows[0] as PutResult;

type Stored = {
  id: string;
  slug: string;
  status: string;
  title: string;
  collection_id: string | null;
  place_id: string | null;
  version: number;
  first_published_at: Date | null;
  published_at: Date | null;
  withdrawn_at: Date | null;
  content_updated_at: Date | null;
  updated_at: Date;
  event_starts_on: string | null;
};

const stored = async (id: string): Promise<Stored> =>
  (
    await admin$<Stored>(
      `select id, slug, status, title, collection_id, place_id, version, first_published_at,
              published_at, withdrawn_at, content_updated_at, updated_at,
              event_starts_on::text as event_starts_on
         from public.news_posts where id = $1`,
      [id],
    )
  )[0]!;

// A draft collection and a place written the way a curator writes them: as krajozbior_app.
const newCollection = async (organizationId: string): Promise<string> =>
  (
    await as(
      curA,
      `insert into public.collections (slug, organization_id, title, region)
       values (?, ?, 'Kolekcja', 'pomorskie') returning id`,
      [`kolekcja-news-${next()}`, organizationId],
    )
  )[0]!.id as string;

const newPlace = async (organizationId: string): Promise<string> =>
  (
    await as(
      curA,
      `insert into public.places (organization_id, name, latitude, longitude)
       values (?, 'Miejsce', 54.1, 18.7) returning id`,
      [organizationId],
    )
  )[0]!.id as string;

describe("news posts of the editorial version (E7-R1)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_news_access");
    await db.migrate();

    for (const { id, email } of [curA, explorer]) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }

    const org = async (name: string, slugValue: string) =>
      (
        await admin$<{ id: string }>(
          `insert into public.organizations (name, slug, kind) values ($1, $2, 'municipality') returning id`,
          [name, slugValue],
        )
      )[0]!.id;

    orgA = await org("Redakcja", "redakcja-news");
    orgB = await org("Gmina B", "gmina-b-news");
    orgS = await org("Gmina S", "gmina-s-news");
    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgS]);
    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [orgA, curA.id],
    );

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  describe("catalog and privileges", () => {
    it("has row security enabled and forced, and the application role is safe", async () => {
      await withClient(db.adminUrl, async (client) => {
        expect(await findRowLevelSecurityGaps(client, ["public.news_posts"])).toEqual([]);
        expect(await findApplicationRoleGaps(client)).toEqual([]);
      });
    });

    it("gives the roles exactly the expected privileges on the table", async () => {
      const rows = await admin$<Record<string, boolean>>(
        `select r.role,
                has_table_privilege(r.role, 'public.news_posts', 'select') as sel,
                has_table_privilege(r.role, 'public.news_posts', 'insert') as ins,
                has_table_privilege(r.role, 'public.news_posts', 'update') as upd,
                has_table_privilege(r.role, 'public.news_posts', 'delete') as del,
                has_table_privilege(r.role, 'public.news_posts', 'truncate') as trunc,
                has_table_privilege(r.role, 'public.news_posts', 'references') as refs,
                has_table_privilege(r.role, 'public.news_posts', 'trigger') as trig,
                has_any_column_privilege(r.role, 'public.news_posts', 'insert') as colins,
                has_any_column_privilege(r.role, 'public.news_posts', 'update') as colupd
           from (values ('krajozbior_app'), ('krajozbior_ops'), ('krajozbior_auth')) as r(role)
          order by r.role`,
      );
      const none = {
        ins: false,
        upd: false,
        del: false,
        trunc: false,
        refs: false,
        trig: false,
        colins: false,
        colupd: false,
      };

      expect(rows).toEqual([
        { role: "krajozbior_app", sel: true, ...none },
        { role: "krajozbior_auth", sel: false, ...none },
        { role: "krajozbior_ops", sel: true, ...none },
      ]);
    });

    it("lets only krajozbior_ops execute ops_put_news", async () => {
      const [fn] = await admin$<{ acl: string; app: boolean; auth: boolean; ops: boolean }>(
        `select p.proacl::text as acl,
                has_function_privilege('krajozbior_app', p.oid, 'execute') as app,
                has_function_privilege('krajozbior_auth', p.oid, 'execute') as auth,
                has_function_privilege('krajozbior_ops', p.oid, 'execute') as ops
           from pg_proc p where p.proname = 'ops_put_news'`,
      );

      expect(fn).toMatchObject({ app: false, auth: false, ops: true });
      // No grant to PUBLIC (the entry of PUBLIC has an empty grantee: `=X/...`).
      expect(fn!.acl).not.toMatch(/(^\{|,)=X\//);

      await expect(
        as(
          curA,
          `select * from public.ops_put_news(?, ?, 'x', 'guide', 'Tytuł', 'l', '', null, null, null, null, 'draft')`,
          [randomUUID(), orgA],
        ),
      ).rejects.toThrow(noPermission);
    });

    it("gives krajozbior_ops only the lookup of a public collection by its address, no read of the table", async () => {
      const draftId = await newCollection(orgA);
      const publicId = await newCollection(orgA);
      const [{ slug: draftSlug }] = await admin$<{ slug: string }>(
        `select slug from public.collections where id = $1`,
        [draftId],
      );
      const [{ slug: publicSlug }] = await admin$<{ slug: string }>(
        `update public.collections set status = 'published' where id = $1 returning slug`,
        [publicId],
      );
      const resolve = async (slugValue: string) =>
        (await ops$(`select public.ops_resolve_news_collection($1) as id`, [slugValue])).rows[0]
          .id as string | null;

      expect(await resolve(publicSlug!)).toBe(publicId);
      // Nothing for a draft or an unknown address: the lookup is no way to list drafts.
      expect(await resolve(draftSlug!)).toBeNull();
      expect(await resolve("nie-ma-takiej-kolekcji")).toBeNull();

      // No direct read of the catalog, whichever column.
      for (const column of ["id", "slug", "organization_id", "title"]) {
        await expect(ops$(`select ${column} from public.collections limit 1`)).rejects.toThrow(
          noPermission,
        );
      }
      await expect(ops$(`select id from public.places limit 1`)).rejects.toThrow(noPermission);

      const [fn] = await admin$<{ acl: string; app: boolean; auth: boolean; ops: boolean }>(
        `select p.proacl::text as acl,
                has_function_privilege('krajozbior_app', p.oid, 'execute') as app,
                has_function_privilege('krajozbior_auth', p.oid, 'execute') as auth,
                has_function_privilege('krajozbior_ops', p.oid, 'execute') as ops
           from pg_proc p where p.proname = 'ops_resolve_news_collection'`,
      );

      expect(fn).toMatchObject({ app: false, auth: false, ops: true });
      expect(fn!.acl).not.toMatch(/(^\{|,)=X\//);
      await expect(
        as(curA, `select public.ops_resolve_news_collection(?)`, [publicSlug]),
      ).rejects.toThrow(noPermission);
      await expect(
        asGuest(`select public.ops_resolve_news_collection(?)`, [publicSlug]),
      ).rejects.toThrow(noPermission);
    });

    it("refuses the owner of the table calling ops_put_news (row security, no row)", async () => {
      // The owner of the function always holds EXECUTE, so the refusal comes from the
      // write policies (session_user is not krajozbior_ops), not from a privilege.
      const item = newPut();

      await expect(
        as$(
          "krajozbior_owner",
          `select * from public.ops_put_news($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          putParams(item),
        ),
      ).rejects.toThrow(rejectedByPolicy);
      expect(await admin$(`select 1 from public.news_posts where id = $1`, [item.id])).toEqual([]);
    });

    it("has exactly the expected policies and one publication trigger", async () => {
      const policies = await admin$<{ name: string; cmd: string; roles: string }>(
        `select polname as name, polcmd as cmd,
                (select string_agg(rolname, ',' order by rolname) from pg_roles
                  where oid = any(polroles)) as roles
           from pg_policy where polrelid = 'public.news_posts'::regclass order by polname`,
      );

      expect(policies).toEqual([
        { name: "news_posts_function_insert", cmd: "a", roles: "krajozbior_owner" },
        { name: "news_posts_function_select", cmd: "r", roles: "krajozbior_owner" },
        { name: "news_posts_function_update", cmd: "w", roles: "krajozbior_owner" },
        { name: "news_posts_ops_select", cmd: "r", roles: "krajozbior_ops" },
        { name: "news_posts_public_select", cmd: "r", roles: "krajozbior_app" },
      ]);

      const triggers = await admin$<{ tgname: string }>(
        `select tgname from pg_trigger where tgrelid = 'public.news_posts'::regclass and not tgisinternal`,
      );
      expect(triggers.map((t) => t.tgname)).toEqual(["news_posts_publication"]);
    });

    it("decides news_posts_is_reference_cleared by what changed (B1)", async () => {
      const collectionId = randomUUID();
      const placeId = randomUUID();
      const other = randomUUID();
      const base = {
        id: randomUUID(),
        organization_id: orgA,
        slug: "adres-funkcji",
        kind: "guide",
        title: "Tytuł funkcji",
        lead: "Opis",
        body: "",
        collection_id: collectionId,
        place_id: placeId,
        event_starts_on: null,
        event_ends_on: null,
        status: "published",
        first_published_at: "2026-11-01T10:00:00Z",
        published_at: "2026-11-01T10:00:00Z",
        withdrawn_at: null,
        content_updated_at: null,
        version: 1,
        created_at: "2026-11-01T09:00:00Z",
        updated_at: "2026-11-01T10:00:00Z",
      };
      const cases: [string, Record<string, unknown>, boolean][] = [
        ["clears the collection", { collection_id: null }, true],
        ["clears the place", { place_id: null }, true],
        ["clears both", { collection_id: null, place_id: null }, true],
        ["changes nothing", {}, false],
        ["changes only updated_at", { updated_at: "2026-11-02T10:00:00Z" }, false],
        ["replaces the collection", { collection_id: other }, false],
        ["replaces the place", { place_id: other }, false],
        ["clears the link and changes version", { collection_id: null, version: 2 }, false],
        ["clears the link and changes title", { collection_id: null, title: "Inny" }, false],
        ["clears the link and changes status", { collection_id: null, status: "withdrawn" }, false],
        ["clears the link and changes slug", { place_id: null, slug: "inny-adres" }, false],
        ["clears the link and changes body", { place_id: null, body: "Treść" }, false],
      ];

      for (const [name, change, expected] of cases) {
        const [row] = await admin$<{ cleared: boolean }>(
          `select public.news_posts_is_reference_cleared(
                    (select r from jsonb_populate_record(null::public.news_posts, $1::jsonb) r),
                    (select r from jsonb_populate_record(null::public.news_posts, $2::jsonb) r)
                  ) as cleared`,
          [JSON.stringify(base), JSON.stringify({ ...base, ...change })],
        );

        expect(row!.cleared, name).toBe(expected);
      }
    });

    it("keeps news_posts_is_reference_cleared in step with the columns of the table", async () => {
      const columns = await admin$<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'news_posts' order by ordinal_position`,
      );
      const [fn] = await admin$<{ prosrc: string }>(
        `select prosrc from pg_proc where proname = 'news_posts_is_reference_cleared'`,
      );

      // `updated_at` is the one column the function ignores on purpose. A column added by a
      // later migration (created_by, hidden_reason, ...) must be added to the function too,
      // or this test fails.
      for (const { column_name: column } of columns.filter((c) => c.column_name !== "updated_at")) {
        expect(fn!.prosrc, column).toMatch(new RegExp(`\\bn\\.${column}\\b`));
      }
    });
  });

  describe("reading", () => {
    let published = "";
    let draft = "";
    let withdrawn = "";
    let ofSuspended = "";

    beforeAll(async () => {
      published = newPut({ status: "published", title: "Opublikowana aktualność" }).id;
      await put(newPut({ id: published, status: "published", title: "Opublikowana aktualność" }));
      draft = (await put(newPut({ title: "Szkic aktualności" }))).put_after.id as string;
      withdrawn = newPut().id;
      await put(newPut({ id: withdrawn, status: "published" }));
      await put(newPut({ id: withdrawn, status: "withdrawn" }));
      ofSuspended = newPut({ organizationId: orgS }).id;
      await put(newPut({ id: ofSuspended, organizationId: orgS, status: "published" }));
    });

    const visibleIds = async (reader: (sql: string) => Promise<Record<string, unknown>[]>) =>
      (await reader(`select id from public.news_posts`)).map((r) => r.id as string);

    it("shows a guest only published news of approved organizations", async () => {
      const ids = await visibleIds((sql) => asGuest(sql));

      expect(ids).toContain(published);
      for (const hidden of [draft, withdrawn, ofSuspended]) expect(ids).not.toContain(hidden);
    });

    it("shows an explorer and a curator of the organization the same, never drafts", async () => {
      for (const actor of [explorer, curA]) {
        const ids = await visibleIds((sql) => as(actor, sql));

        expect(ids).toContain(published);
        for (const hidden of [draft, withdrawn, ofSuspended]) expect(ids).not.toContain(hidden);
      }
    });

    it("hides the news of an organization while it is suspended and shows it again when approved (S4)", async () => {
      const item = newPut({ status: "published", title: "Aktualność zawieszana" });

      await put(item);
      expect(await visibleIds((sql) => asGuest(sql))).toContain(item.id);

      await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgA]);
      try {
        expect(await visibleIds((sql) => asGuest(sql))).not.toContain(item.id);
        expect(await visibleIds((sql) => as(explorer, sql))).not.toContain(item.id);
      } finally {
        await admin$(`update public.organizations set status = 'approved' where id = $1`, [orgA]);
      }

      expect(await visibleIds((sql) => asGuest(sql))).toContain(item.id);
    });

    it("shows krajozbior_ops every row, for the preview of the import", async () => {
      const { rows } = await ops$(`select id from public.news_posts`);
      const ids = rows.map((r) => r.id as string);

      for (const id of [published, draft, withdrawn, ofSuspended]) expect(ids).toContain(id);
    });
  });

  describe("writing is closed to everyone but ops_put_news", () => {
    const insertSql = `insert into public.news_posts (organization_id, slug, kind, title, lead)
       values (?, 'bezposredni-zapis', 'guide', 'Tytuł aktualności', 'Opis')`;

    it("refuses krajozbior_app (guest, explorer, curator): insert, update, delete", async () => {
      const target = newPut();

      await put({ ...target, status: "published" });

      for (const run of [
        asGuest,
        (sql: string, p?: unknown[]) => as(explorer, sql, p),
        (sql: string, p?: unknown[]) => as(curA, sql, p),
      ]) {
        // A guest transaction is read-only, so it refuses before the privilege check.
        await expect(run(insertSql, [orgA])).rejects.toThrow(writeRefused);
        await expect(
          run(`update public.news_posts set title = 'Podmieniony tytuł' where id = ?`, [target.id]),
        ).rejects.toThrow(writeRefused);
        await expect(
          run(`delete from public.news_posts where id = ?`, [target.id]),
        ).rejects.toThrow(writeRefused);
      }
      expect((await stored(target.id)).title).toBe(target.title);
    });

    it("refuses krajozbior_ops a direct insert, update and delete", async () => {
      const target = newPut();

      await put({ ...target, status: "published" });

      await expect(
        ops$(
          `insert into public.news_posts (organization_id, slug, kind, title, lead)
           values ($1, 'bezposredni-ops', 'guide', 'Tytuł aktualności', 'Opis')`,
          [orgA],
        ),
      ).rejects.toThrow(noPermission);
      await expect(
        ops$(`update public.news_posts set title = 'Podmieniony tytuł' where id = $1`, [target.id]),
      ).rejects.toThrow(noPermission);
      await expect(
        ops$(`delete from public.news_posts where id = $1`, [target.id]),
      ).rejects.toThrow(noPermission);
    });

    it("refuses krajozbior_auth", async () => {
      await expect(as$("krajozbior_auth", `select 1 from public.news_posts`)).rejects.toThrow(
        noPermission,
      );
    });

    it("does not leave the write switch on after the function returns (S1)", async () => {
      const item = newPut({ status: "published" });

      await withClient(db.urls.krajozbior_ops, async (client) => {
        await client.query("begin");
        try {
          await putIn(client, item);

          const [{ value }] = (
            await client.query(`select current_setting('krajozbior.news_write', true) as value`)
          ).rows as { value: string | null }[];

          expect(value).not.toBe("on");
          await expect(
            client.query(`update public.news_posts set title = 'Podmieniony tytuł' where id = $1`, [
              item.id,
            ]),
          ).rejects.toThrow(noPermission);
        } finally {
          await client.query("rollback");
        }
      });
    });

    it("refuses a login as the table owner, even with the transaction variable set", async () => {
      await withClient(db.urls.krajozbior_owner, async (client) => {
        await client.query("begin");
        await client.query(`select set_config('krajozbior.news_write', 'on', true)`);
        await expect(
          client.query(
            `insert into public.news_posts (organization_id, slug, kind, title, lead)
             values ($1, 'zapis-wlasciciela', 'guide', 'Tytuł aktualności', 'Opis')`,
            [orgA],
          ),
        ).rejects.toThrow(rejectedByPolicy);
        await client.query("rollback");

        const target = newPut();

        await put({ ...target, status: "published" });
        const updated = await client.query(
          `update public.news_posts set title = 'Zmiana właściciela' where id = $1`,
          [target.id],
        );

        expect(updated.rowCount).toBe(0);
        expect((await stored(target.id)).title).toBe(target.title);
      });
    });
  });

  describe("ops_put_news", () => {
    it("creates, updates and leaves unchanged; unchanged does not raise the version", async () => {
      const first = newPut({ title: "Pierwszy tytuł" });
      const created = await put(first);

      expect(created.put_result).toBe("created");
      expect(created.put_before).toBeNull();
      expect(created.put_after).toEqual({
        id: first.id,
        slug: first.slug,
        status: "draft",
        organization_id: orgA,
        collection_id: null,
        place_id: null,
      });
      expect((await stored(first.id)).version).toBe(1);

      const same = await put(first);
      expect(same.put_result).toBe("unchanged");
      expect(same.put_before).toEqual(same.put_after);
      expect((await stored(first.id)).version).toBe(1);

      const changed = await put({ ...first, title: "Drugi tytuł" });
      expect(changed.put_result).toBe("updated");
      expect(changed.put_before).toMatchObject({ status: "draft" });
      expect(await stored(first.id)).toMatchObject({ title: "Drugi tytuł", version: 2 });
    });

    it("keeps the title and the text out of the state that goes to the audit", async () => {
      const result = await put(newPut({ title: "Tajny tytuł", lead: "Tajny opis", body: "Treść" }));

      expect(Object.keys(result.put_after).sort()).toEqual([
        "collection_id",
        "id",
        "organization_id",
        "place_id",
        "slug",
        "status",
      ]);
    });

    it("computes the dates and keeps the slug fixed after the first publication", async () => {
      const item = newPut({ slug: "adres-roboczy", title: "Tytuł przed publikacją" });

      await put(item);
      // A draft keeps its slug; the first publication takes the slug given with it.
      await put({ ...item, slug: "adres-inny", title: "Tytuł po zmianie" });
      expect((await stored(item.id)).slug).toBe("adres-roboczy");

      await put({ ...item, slug: "adres-staly", title: "Tytuł po zmianie", status: "published" });
      const live = await stored(item.id);

      expect(live.slug).toBe("adres-staly");
      expect(live.first_published_at).not.toBeNull();
      expect(live.published_at).not.toBeNull();
      expect(live.content_updated_at).toBeNull();

      await put({
        ...item,
        slug: "adres-zmieniony",
        title: "Poprawiony tytuł",
        status: "published",
      });
      const edited = await stored(item.id);

      expect(edited.slug).toBe("adres-staly");
      // D-E7-9: a change of the content of a published item sets it.
      expect(edited.content_updated_at).not.toBeNull();
      expect(edited.published_at).toEqual(live.published_at);

      await put({ ...item, title: "Poprawiony tytuł", status: "withdrawn" });
      const withdrawn = await stored(item.id);

      expect(withdrawn.withdrawn_at).not.toBeNull();
      expect(withdrawn.content_updated_at).toEqual(edited.content_updated_at);
      expect(withdrawn.published_at).toEqual(live.published_at);

      await put({ ...item, title: "Poprawiony tytuł", status: "published" });
      const again = await stored(item.id);

      expect(again.withdrawn_at).toBeNull();
      expect(again.first_published_at).toEqual(live.first_published_at);
      expect(again.published_at!.getTime()).toBeGreaterThanOrEqual(live.published_at!.getTime());
      expect(again.content_updated_at).toEqual(edited.content_updated_at);
    });

    it("does not touch content_updated_at when only the state or a link changes", async () => {
      const item = newPut({ status: "published" });

      await put(item);
      const collectionId = await newCollection(orgA);
      await put({ ...item, collectionId });

      expect(await stored(item.id)).toMatchObject({ content_updated_at: null, version: 2 });
    });

    it("allows exactly the transitions of S20", async () => {
      // The state the item is in before the call, and the state asked for.
      const reach = async (from: "draft" | "published" | "withdrawn"): Promise<Put> => {
        const item = newPut();

        await put(item);
        if (from !== "draft") await put({ ...item, status: "published" });
        if (from === "withdrawn") await put({ ...item, status: "withdrawn" });
        return { ...item, status: from };
      };
      const allowed: [string, string][] = [
        ["draft", "draft"],
        ["draft", "published"],
        ["published", "published"],
        ["published", "withdrawn"],
        ["withdrawn", "withdrawn"],
        ["withdrawn", "published"],
      ];
      const refused: [string, string][] = [
        ["draft", "withdrawn"],
        ["published", "draft"],
        ["withdrawn", "draft"],
      ];

      for (const [from, to] of allowed) {
        const item = await reach(from as "draft");
        const result = await put({ ...item, status: to, title: "Zmieniony tytuł" });

        expect(result.put_result, `${from} -> ${to}`).toBe("updated");
        expect((await stored(item.id)).status).toBe(to);
      }
      for (const [from, to] of refused) {
        const item = await reach(from as "draft");

        await expect(put({ ...item, status: to }), `${from} -> ${to}`).rejects.toMatchObject({
          code: "P0001",
          message: "invalid_transition",
        });
        expect((await stored(item.id)).status).toBe(from);
      }
      // A new item is created as a draft or as published, never as withdrawn.
      await expect(put(newPut({ status: "withdrawn" }))).rejects.toMatchObject({
        code: "P0001",
        message: "invalid_transition",
      });
    });

    it("refuses a link to a collection or a place of another organization, or a missing one (stale_link)", async () => {
      const ownCollection = await newCollection(orgA);
      const foreignCollection = (
        await admin$<{ id: string }>(
          `insert into public.collections (slug, organization_id, title, region)
           values ($1, $2, 'Cudza', 'pomorskie') returning id`,
          [`cudza-${next()}`, orgB],
        )
      )[0]!.id;
      const foreignPlace = (
        await admin$<{ id: string }>(
          `insert into public.places (organization_id, name, latitude, longitude)
           values ($1, 'Cudze miejsce', 54.1, 18.7) returning id`,
          [orgB],
        )
      )[0]!.id;

      for (const link of [
        { collectionId: foreignCollection },
        { collectionId: randomUUID() },
        { placeId: foreignPlace },
        { placeId: randomUUID() },
      ]) {
        await expect(put(newPut(link))).rejects.toMatchObject({
          code: "P0001",
          message: "stale_link",
        });
      }

      // The same on an update of an existing item, and an own link works.
      const item = newPut();

      await put(item);
      await expect(put({ ...item, collectionId: foreignCollection })).rejects.toMatchObject({
        code: "P0001",
        message: "stale_link",
      });
      await expect(put({ ...item, collectionId: ownCollection })).resolves.toMatchObject({
        put_result: "updated",
      });
    });

    it("refuses the 201st news item of an organization, but still edits the existing ones", async () => {
      await admin$(
        `insert into public.news_posts (organization_id, slug, kind, title, lead)
         select $1, 'seryjna-' || g, 'guide', 'Tytuł seryjny', 'Opis'
           from generate_series(1, 200) g`,
        [orgB],
      );

      await expect(put(newPut({ organizationId: orgB }))).rejects.toMatchObject({
        code: "P0001",
        message: "too_many_news",
      });

      const [existing] = await admin$<{ id: string }>(
        `select id from public.news_posts where organization_id = $1 limit 1`,
        [orgB],
      );

      await expect(
        put(
          newPut({ id: existing!.id, organizationId: orgB, slug: null, title: "Edytowany tytuł" }),
        ),
      ).resolves.toMatchObject({ put_result: "updated" });
    });

    it("does not move an item to another organization", async () => {
      const item = newPut();

      await put(item);
      await expect(put({ ...item, organizationId: orgB })).rejects.toThrow(/cannot change/);
    });

    it("repeats the limits of the domain in CHECK constraints", async () => {
      const checkViolation = { code: "23514" };
      const refusedValues: Partial<Put>[] = [
        { title: "Abcd" }, // 4 characters
        { title: "A".repeat(121) },
        { title: "Café stop" }, // not NFC
        { title: "Tytuł z \u0007 znakiem" }, // control character
        { lead: "" },
        { lead: "L".repeat(281) },
        { body: "B".repeat(5001) },
        { body: "wiersz\twiersz" }, // a tab; only the line feed is allowed
        { slug: "Zły Adres" },
        { kind: "inny" },
        { kind: "event" }, // an event needs a start date
        { eventStartsOn: "2026-12-01" }, // only an event has dates
        { kind: "event", eventStartsOn: "1999-12-31" },
        { kind: "event", eventStartsOn: "2101-01-01" },
        { kind: "event", eventStartsOn: "2026-12-05", eventEndsOn: "2026-12-04" },
        { kind: "event", eventStartsOn: "2026-12-05", eventEndsOn: "2101-01-01" },
      ];

      for (const values of refusedValues) {
        await expect(
          put(newPut(values)),
          JSON.stringify(values).slice(0, 60),
        ).rejects.toMatchObject(checkViolation);
      }

      await expect(
        put(
          newPut({
            kind: "event",
            eventStartsOn: "2000-01-01",
            eventEndsOn: "2100-12-31",
            body: "wiersz\nwiersz",
            title: "Zażółć gęślą jaźń",
          }),
        ),
      ).resolves.toMatchObject({ put_result: "created" });
    });
  });

  describe("the audit entry of the caller (B7, S24)", () => {
    it("is written by krajozbior_ops in the transaction of the function, without details", async () => {
      const item = newPut({ status: "published" });

      await withClient(db.urls.krajozbior_ops, async (client) => {
        await client.query("begin");
        const result = await putIn(client, item);

        await writeAuditEntry(client, {
          operation: "news_import",
          operator: "test",
          reason: "Próba wgrania aktualności",
          subjectUserId: null,
          organizationId: orgA,
          before: null,
          after: result.put_after,
          outcome: "applied",
          code: null,
        });
        await client.query("commit");
      });

      const [entry] = await admin$<Record<string, unknown>>(
        `select operation, outcome, organization_id, subject_user_id, before_state, after_state,
                details, recorded_by
           from public.operations_audit
          where operation = 'news_import' and after_state ->> 'id' = $1`,
        [item.id],
      );

      expect(entry).toMatchObject({
        operation: "news_import",
        outcome: "applied",
        organization_id: orgA,
        subject_user_id: null,
        before_state: null,
        details: null,
        recorded_by: "krajozbior_ops",
      });
      expect(entry!.after_state).toMatchObject({
        id: item.id,
        slug: item.slug,
        status: "published",
      });
    });

    it("refuses details for news_import and accepts the three refusal codes", async () => {
      await withClient(db.urls.krajozbior_ops, async (client) => {
        const base = {
          operation: "news_import" as const,
          operator: "test",
          reason: "Próba",
          subjectUserId: null,
          organizationId: orgA,
          before: null,
          after: { id: randomUUID(), line: 3 },
          outcome: "rejected" as const,
        };

        await expect(
          writeAuditEntry(client, { ...base, code: "stale_link", details: { sha256: "x" } }),
        ).rejects.toMatchObject({ code: "23514" });

        for (const code of [
          "invalid_transition",
          "stale_link",
          "too_many_news",
          "slug_taken",
        ] as const) {
          await expect(writeAuditEntry(client, { ...base, code })).resolves.toBeDefined();
        }
      });
    });

    it("leaves no news item when the transaction of the function is rolled back", async () => {
      const item = newPut();

      await withClient(db.urls.krajozbior_ops, async (client) => {
        await client.query("begin");
        await putIn(client, item);
        await client.query("rollback");
      });

      expect(await admin$(`select 1 from public.news_posts where id = $1`, [item.id])).toEqual([]);
    });

    it("is not written by ops_put_news itself, only by the caller (S3)", async () => {
      const item = newPut({ status: "published" });
      const countEntries = async () =>
        (await admin$<{ n: number }>(`select count(*)::int as n from public.operations_audit`))[0]!
          .n;
      const before = await countEntries();

      await withClient(db.urls.krajozbior_ops, async (client) => {
        await client.query("begin");
        await putIn(client, item);
        await client.query("commit");
      });
      await put({ ...item, title: "Zmieniony tytuł aktualności" });

      expect(await countEntries()).toBe(before);
      expect(
        await admin$(
          `select 1 from public.operations_audit
            where after_state ->> 'id' = $1 or before_state ->> 'id' = $1`,
          [item.id],
        ),
      ).toEqual([]);
    });

    it("cannot be written by krajozbior_owner or krajozbior_app", async () => {
      await expect(
        as$(
          "krajozbior_owner",
          `insert into public.operations_audit (operation, operator_label, outcome, reason)
           values ('news_import', 'x', 'applied', 'r')`,
        ),
      ).rejects.toThrow(rejectedByPolicy);
      await expect(
        as(
          curA,
          `insert into public.operations_audit (operation, operator_label, outcome, reason)
           values ('news_import', 'x', 'applied', 'r')`,
        ),
      ).rejects.toThrow(noPermission);
    });
  });

  describe("removing a collection or a place that a news item points at (B1, D-E7-10)", () => {
    // The news item loses only the link: its state, dates, content and version stay.
    const expectOnlyLinkCleared = (
      before: Stored,
      after: Stored,
      link: "collection_id" | "place_id",
    ) => {
      expect(before[link]).not.toBeNull();
      expect(after[link]).toBeNull();
      expect({ ...after, [link]: undefined, updated_at: undefined }).toEqual({
        ...before,
        [link]: undefined,
        updated_at: undefined,
      });
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    };

    const states = ["draft", "published", "withdrawn"] as const;
    const reachState = async (item: Put, state: (typeof states)[number]) => {
      await put({ ...item, status: state === "draft" ? "draft" : "published" });
      if (state === "withdrawn") await put({ ...item, status: "withdrawn" });
    };

    it.each(states)(
      "lets a curator delete a draft collection pointed at by a %s item",
      async (state) => {
        const collectionId = await newCollection(orgA);
        const item = newPut({ collectionId });

        await reachState(item, state);
        // An edit of the content first, so that content_updated_at and version are not trivial.
        if (state === "published")
          await put({ ...item, collectionId, status: "published", title: "Zmieniony tytuł" });
        const before = await stored(item.id);

        const deleted = await as(curA, `delete from public.collections where id = ? returning id`, [
          collectionId,
        ]);

        expect(deleted).toHaveLength(1);
        expectOnlyLinkCleared(before, await stored(item.id), "collection_id");
      },
    );

    it.each(states)("lets a curator delete a place pointed at by a %s item", async (state) => {
      const placeId = await newPlace(orgA);
      const item = newPut({ placeId });

      await reachState(item, state);
      const before = await stored(item.id);

      // The path of the loader (`catalog_remove`, deletePlace): a savepoint around the delete.
      const deleted = await runInUserContext(app.em, curA, async ({ em }) => {
        await em.execute(`savepoint import_delete_place`, [], "run");
        const rows = await em.execute<unknown[]>(
          `delete from public.places where id = ? returning id`,
          [placeId],
        );

        await em.execute(`release savepoint import_delete_place`, [], "run");
        return rows;
      });

      expect(deleted).toHaveLength(1);
      expectOnlyLinkCleared(before, await stored(item.id), "place_id");
    });

    it("clears only the removed link when the item has both", async () => {
      const collectionId = await newCollection(orgA);
      const placeId = await newPlace(orgA);
      const item = newPut({ collectionId, placeId, status: "published" });

      await put(item);
      await as(curA, `delete from public.places where id = ?`, [placeId]);

      expect(await stored(item.id)).toMatchObject({ collection_id: collectionId, place_id: null });
    });

    it("does not let the news item decide the removal for another organization", async () => {
      // The foreign key is composite with the organization, so the link cannot cross it.
      const collectionId = await newCollection(orgA);

      await expect(
        admin$(
          `insert into public.news_posts (organization_id, slug, kind, title, lead, collection_id)
           values ($1, 'obce-powiazanie', 'guide', 'Tytuł aktualności', 'Opis', $2)`,
          [orgB, collectionId],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  describe("the migration", () => {
    it("reverts and applies again", async () => {
      const item = newPut({ status: "published" });

      await put(item);
      const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));
      const tableExists = async () =>
        (
          await admin$<{ t: string | null }>(`select to_regclass('public.news_posts')::text as t`)
        )[0]!.t;
      const functions = async () =>
        (
          await admin$<{ n: number }>(
            `select count(*)::int as n from pg_proc
              where proname in ('ops_put_news', 'news_posts_publication',
                                'news_posts_is_reference_cleared', 'news_posts_audit_state')`,
          )
        )[0]!.n;
      const allowsNewsImport = async () =>
        (
          await admin$<{ ok: boolean }>(
            `select pg_get_constraintdef(oid) like '%news_import%' as ok
               from pg_constraint where conname = 'operations_audit_operation_check'`,
          )
        )[0]!.ok;

      try {
        expect(await allowsNewsImport()).toBe(true);
        await owner.migrator.down({ to: "Migration20261121150000_account_settings" });
        expect(await tableExists()).toBeNull();
        expect(await functions()).toBe(0);
        expect(await allowsNewsImport()).toBe(false);

        await owner.migrator.up();
        expect(await tableExists()).toBe("news_posts");
        expect(await functions()).toBe(4);
        expect(await allowsNewsImport()).toBe(true);
        // The writer works again after the round trip, and so does the audit.
        await expect(put(newPut({ status: "published" }))).resolves.toMatchObject({
          put_result: "created",
        });
        await expect(
          ops$(
            `insert into public.operations_audit (operation, operator_label, outcome, reason)
             values ('news_import', 'op', 'applied', 'powód')`,
          ),
        ).resolves.toBeDefined();
      } finally {
        await owner.close(true);
      }
    });
  });
});
