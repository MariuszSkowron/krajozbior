import { randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// `place_photos` (E4-2a) on the real database. Every claim goes through a real LOGIN connection
// of the role (`krajozbior_app` pooled with one connection, so a leaked context would show;
// `krajozbior_ops` on a short connection); the superuser only prepares rows no policy lets the
// roles write, and reads the catalog. Class: public once the place lies in a published
// collection of an approved organization and the photo is ready and not hidden, otherwise CUR.
const rejectedByPolicy = /row-level security/;
const noPermission = /permission denied/;
const cc = "https://creativecommons.org";

let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("cur-a");
const curB = user("cur-b");
const explorer = user("explorer");

let orgA = "";
let orgB = "";
let counter = 0;

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const ops$ = (sql: string, params: unknown[] = []) =>
  withClient(db.urls.krajozbior_ops, (client) => client.query(sql, params));
const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
  runInUserContext(app.em, actor, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));
const asGuest = (sql: string, params: unknown[] = []) =>
  runInGuestContext(app.em, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));

const newPlace = async (organizationId: string): Promise<string> =>
  (
    await admin$<{ id: string }>(
      `insert into public.places (organization_id, name, latitude, longitude)
       values ($1, 'Miejsce', 54.1, 18.7) returning id`,
      [organizationId],
    )
  )[0]!.id;

// A collection with the place; published (status set after the link, as the trigger demands).
const collectionWith = async (placeId: string, organizationId: string, published: boolean) => {
  const [{ id }] = await admin$<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, region, status)
     values ($1, $2, 'Kolekcja', 'pomorskie', 'draft') returning id`,
    [`kolekcja-${(counter += 1)}`, organizationId],
  );

  await admin$(
    `insert into public.collection_places (collection_id, place_id, organization_id, position)
     values ($1, $2, $3, 1)`,
    [id, placeId, organizationId],
  );

  if (published) {
    await admin$(`update public.collections set status = 'published' where id = $1`, [id]);
  }
};

type Row = {
  state?: "ready" | "pending_fetch" | "fetch_failed";
  kind?: "own" | "third_party" | "commons_import";
  hidden?: boolean;
  licenseCode?: string;
  licenseUrl?: string | null;
};

// A row prepared by the superuser (the policies would not let a role write most of these).
const photo = async (placeId: string, organizationId: string, row: Row = {}) => {
  const state = row.state ?? "ready";
  const kind = row.kind ?? "commons_import";
  const n = (counter += 1);

  return (
    await admin$<{ id: string }>(
      `insert into public.place_photos
         (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
          source_kind, author_text, source_url, license_code, license_url, license_label,
          rights_statement, commons_file, hidden_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'Opis', $8, 'Autor', 'https://commons.wikimedia.org/wiki/File:X.jpg',
               $9, $10, 'CC BY-SA 4.0', 'commons-import/1', $11, $12)
       returning id`,
      [
        organizationId,
        placeId,
        n,
        state,
        state === "ready" ? randomUUID() : null,
        state === "ready" ? 1280 : null,
        state === "ready" ? 853 : null,
        kind,
        row.licenseCode ?? "cc-by-sa-4.0",
        row.licenseUrl === undefined ? `${cc}/licenses/by-sa/4.0/` : row.licenseUrl,
        kind === "commons_import" ? `Plik ${n}.jpg` : null,
        row.hidden === true ? new Date().toISOString() : null,
      ],
    )
  )[0]!.id;
};

// The only INSERT the app may do: a row from a file, without a file.
const insertPending = (
  actor: { id: string },
  organizationId: string,
  placeId: string,
  overrides: Partial<Record<string, string | number | null>> = {},
) => {
  const values = {
    organization_id: organizationId,
    place_id: placeId,
    position: 1,
    file_state: "pending_fetch",
    source_kind: "commons_import",
    alt_text: "Opis",
    author_text: "Autor",
    source_url: "https://commons.wikimedia.org/wiki/File:Y.jpg",
    license_code: "cc-by-sa-4.0",
    license_url: `${cc}/licenses/by-sa/4.0/`,
    license_label: "CC BY-SA 4.0",
    rights_statement: "commons-import/1",
    commons_file: `Plik ${(counter += 1)}.jpg`,
    ...overrides,
  };
  const columns = Object.keys(values);

  return as(
    actor,
    `insert into public.place_photos (${columns.join(", ")})
     values (${columns.map(() => "?").join(", ")}) returning id`,
    Object.values(values),
  );
};

describe("place photos", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_place_photos");
    await db.migrate();

    for (const { id, email } of [curA, curB, explorer]) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }

    const org = async (slug: string, member: { id: string }) => {
      const [{ id }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ($1, $1, 'municipality') returning id`,
        [slug],
      );

      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [id, member.id],
      );

      return id;
    };

    orgA = await org("gmina-a", curA);
    orgB = await org("gmina-b", curB);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("has row security enabled, forced and policies, and a safe app role", async () => {
    const gaps = await withClient(db.adminUrl, async (client) => [
      ...(await findRowLevelSecurityGaps(client, ["public.place_photos"])),
      ...(await findApplicationRoleGaps(client)),
    ]);

    expect(gaps).toEqual([]);
  });

  it("gives krajozbior_app exactly the intended privileges and the other roles none beyond ops", async () => {
    const check = async (role: string, table: string, columns: string[], privilege: string) =>
      Object.fromEntries(
        await Promise.all(
          columns.map(async (column) => [
            column,
            (
              await admin$<{ allowed: boolean }>(
                `select has_column_privilege($1, $2, $3, $4) as allowed`,
                [role, table, column, privilege],
              )
            )[0]!.allowed,
          ]),
        ),
      );
    const table = "public.place_photos";

    expect(
      await check(
        "krajozbior_app",
        table,
        [
          "id",
          "place_id",
          "file_state",
          "storage_key",
          "license_label",
          "source_width",
          "commons_file",
          "content_sha256",
          "created_by",
          "hidden_at",
          "hidden_reason",
          "fetch_attempts",
          "rights_statement",
          "retrieved_at",
        ],
        "select",
      ),
    ).toEqual({
      id: true,
      place_id: true,
      file_state: true,
      storage_key: true,
      license_label: true,
      source_width: true,
      commons_file: false,
      content_sha256: false,
      created_by: false,
      hidden_at: false,
      hidden_reason: false,
      fetch_attempts: false,
      rights_statement: false,
      retrieved_at: false,
    });
    expect(
      await check(
        "krajozbior_app",
        table,
        [
          "commons_file",
          "file_state",
          "storage_key",
          "width",
          "height",
          "content_sha256",
          "created_by",
          "hidden_at",
          "fetch_attempts",
          "id",
        ],
        "insert",
      ),
    ).toEqual({
      commons_file: true,
      file_state: true,
      storage_key: false,
      width: false,
      height: false,
      content_sha256: false,
      created_by: false,
      hidden_at: false,
      fetch_attempts: false,
      id: false,
    });
    expect(
      await check(
        "krajozbior_app",
        table,
        [
          "position",
          "alt_text",
          "license_label",
          "version",
          "file_state",
          "storage_key",
          "width",
          "height",
          "content_sha256",
          "fetch_attempts",
          "organization_id",
          "place_id",
          "source_kind",
        ],
        "update",
      ),
    ).toEqual({
      position: true,
      alt_text: true,
      license_label: true,
      version: true,
      file_state: false,
      storage_key: false,
      width: false,
      height: false,
      content_sha256: false,
      fetch_attempts: false,
      organization_id: false,
      place_id: false,
      source_kind: false,
    });
    expect(
      await check(
        "krajozbior_ops",
        table,
        [
          "id",
          "storage_key",
          "commons_file",
          "fetch_attempts",
          "retrieved_at",
          "license_code",
          "alt_text",
          "content_sha256",
          "rights_statement",
          "hidden_at",
          "created_by",
        ],
        "select",
      ),
    ).toEqual({
      id: true,
      storage_key: true,
      commons_file: true,
      fetch_attempts: true,
      // The version check of `photos:fetch` reads the day of the selection and the licence code.
      retrieved_at: true,
      license_code: true,
      alt_text: false,
      content_sha256: false,
      rights_statement: false,
      hidden_at: false,
      created_by: false,
    });
    expect(
      await check(
        "krajozbior_ops",
        table,
        [
          "file_state",
          "storage_key",
          "width",
          "height",
          "content_sha256",
          "fetch_attempts",
          "alt_text",
          "hidden_at",
          "license_code",
        ],
        "update",
      ),
    ).toEqual({
      file_state: true,
      storage_key: true,
      width: true,
      height: true,
      content_sha256: true,
      fetch_attempts: true,
      alt_text: false,
      hidden_at: false,
      license_code: false,
    });

    const [tables] = await admin$<Record<string, boolean>>(
      `select
         has_table_privilege('krajozbior_app', 'place_photos', 'delete') as app_delete,
         has_table_privilege('krajozbior_app', 'place_photos', 'truncate, references, trigger') as app_other,
         has_table_privilege('krajozbior_ops', 'place_photos', 'insert, delete, truncate, references, trigger') as ops_other,
         has_any_column_privilege('krajozbior_auth', 'place_photos', 'select, insert, update') as auth_any`,
    );

    expect(tables).toEqual({
      app_delete: true,
      app_other: false,
      ops_other: false,
      auth_any: false,
    });
  });

  it("lets a full_edit member insert only a row from a file, without a file", async () => {
    const placeId = await newPlace(orgA);
    const [{ id }] = (await insertPending(curA, orgA, placeId)) as { id: string }[];

    const [row] = await admin$<{
      file_state: string;
      storage_key: string | null;
      created_by: string;
    }>(`select file_state, storage_key, created_by from public.place_photos where id = $1`, [id]);

    // `created_by` is the default of the database (the member who filed the statement).
    expect(row).toEqual({ file_state: "pending_fetch", storage_key: null, created_by: curA.id });
  });

  it("refuses a row of the app that is ready, own, third-party or carries any file column", async () => {
    const placeId = await newPlace(orgA);
    let position = 10;
    const refused = (overrides: Partial<Record<string, string | number | null>>) =>
      insertPending(curA, orgA, placeId, { position: (position += 1), ...overrides });

    await expect(refused({ file_state: "ready" })).rejects.toThrow(rejectedByPolicy);
    // File columns have no INSERT grant for the app at all (the restrictive policy is a second wall).
    await expect(refused({ storage_key: randomUUID() })).rejects.toThrow(noPermission);
    await expect(refused({ width: 100 })).rejects.toThrow(noPermission);
    await expect(refused({ height: 100 })).rejects.toThrow(noPermission);
    await expect(refused({ source_kind: "own" })).rejects.toThrow(rejectedByPolicy);
    await expect(refused({ source_kind: "third_party" })).rejects.toThrow(rejectedByPolicy);
    await expect(refused({ file_state: "fetch_failed" })).rejects.toThrow(rejectedByPolicy);
    await expect(
      as(
        curA,
        `insert into public.place_photos
           (organization_id, place_id, position, file_state, source_kind, alt_text, author_text,
            source_url, license_code, license_url, license_label, rights_statement, commons_file,
            content_sha256)
         values (?, ?, 20, 'pending_fetch', 'commons_import', 'x', 'x',
                 'https://commons.wikimedia.org/wiki/File:Z.jpg', 'cc-by-4.0', ?, 'CC BY 4.0',
                 'commons-import/1', 'Z.jpg', decode(repeat('ab', 32), 'hex'))`,
        [orgA, placeId, `${cc}/licenses/by/4.0/`],
      ),
    ).rejects.toThrow(noPermission);
    // Columns the app has no grant for at all.
    for (const column of ["created_by", "hidden_at", "fetch_attempts"]) {
      const value = column === "created_by" ? curA.id : column === "hidden_at" ? "now()" : "1";

      await expect(
        as(
          curA,
          `insert into public.place_photos
             (organization_id, place_id, position, file_state, source_kind, alt_text, author_text,
              source_url, license_code, license_url, license_label, rights_statement, commons_file, ${column})
           values (?, ?, 30, 'pending_fetch', 'commons_import', 'x', 'x',
                   'https://commons.wikimedia.org/wiki/File:Q.jpg', 'cc-by-4.0', ?, 'CC BY 4.0',
                   'commons-import/1', 'Q.jpg', ${column === "hidden_at" ? value : "?"})`,
          column === "hidden_at"
            ? [orgA, placeId, `${cc}/licenses/by/4.0/`]
            : [orgA, placeId, `${cc}/licenses/by/4.0/`, value],
        ),
      ).rejects.toThrow(noPermission);
    }
  });

  it("refuses a guest, an explorer and the member of another organization", async () => {
    const placeId = await newPlace(orgA);

    await expect(
      asGuest(`insert into public.place_photos (organization_id) values (?)`, [orgA]),
    ).rejects.toThrow(/read-only/);
    await expect(insertPending(explorer, orgA, placeId)).rejects.toThrow(rejectedByPolicy);
    await expect(insertPending(curB, orgA, placeId)).rejects.toThrow(rejectedByPolicy);
    // Naming the own organization does not help: the place belongs to A (composite key, 23503).
    await expect(insertPending(curB, orgB, placeId)).rejects.toThrow(
      /foreign key|row-level security/,
    );
  });

  it("shows a photo to a guest only when it is ready, not hidden and public", async () => {
    const placeId = await newPlace(orgA);
    const draftPlace = await newPlace(orgA);
    const suspendedPlace = await newPlace(orgB);

    await collectionWith(placeId, orgA, true);
    await collectionWith(draftPlace, orgA, false);
    await collectionWith(suspendedPlace, orgB, true);

    const visible = await photo(placeId, orgA);
    const pending = await photo(placeId, orgA, { state: "pending_fetch" });
    const failed = await photo(placeId, orgA, { state: "fetch_failed" });
    const hidden = await photo(placeId, orgA, { hidden: true });
    const inDraft = await photo(draftPlace, orgA);
    const ofSuspended = await photo(suspendedPlace, orgB);

    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgB]);

    const ids = [visible, pending, failed, hidden, inDraft, ofSuspended];
    const mine = `select id from public.place_photos where id in (${ids.map(() => "?").join(", ")})`;
    const seen = async (rows: Promise<Record<string, unknown>[]>) =>
      (await rows).map((row) => row.id as string).sort();

    // Guest, an explorer and the other organization: only the ready photo of the public place.
    expect(await seen(asGuest(mine, ids))).toEqual([visible]);
    expect(await seen(as(explorer, mine, ids))).toEqual([visible]);
    expect(await seen(as(curA, mine, ids))).toEqual(
      [visible, pending, failed, hidden, inDraft].sort(),
    );
    // The member of B sees the same as a guest: the row of the own organization is out of sight
    // while the organization is suspended (it holds no permission), and the other ones are A's.
    expect(await seen(as(curB, mine, ids))).toEqual([visible]);
  });

  it("does not show the columns the app has no grant for, even for a visible photo", async () => {
    const placeId = await newPlace(orgA);

    await collectionWith(placeId, orgA, true);
    await photo(placeId, orgA);

    for (const column of [
      "commons_file",
      "content_sha256",
      "created_by",
      "hidden_at",
      "fetch_attempts",
    ]) {
      await expect(asGuest(`select ${column} from public.place_photos`)).rejects.toThrow(
        noPermission,
      );
      await expect(as(curA, `select ${column} from public.place_photos`)).rejects.toThrow(
        noPermission,
      );
    }
  });

  it("lets the app update the signature columns of its own rows only, never the file or the state", async () => {
    const placeId = await newPlace(orgA);
    const id = await photo(placeId, orgA, { state: "pending_fetch" });
    const update = (actor: { id: string }, set: string) =>
      as(actor, `update public.place_photos set ${set} where id = ? returning id`, [id]);

    expect(await update(curA, `alt_text = 'Nowy opis', version = version + 1`)).toHaveLength(1);
    // Another organization, an explorer and a guest change nothing.
    expect(await update(curB, `alt_text = 'Cudzy'`)).toEqual([]);
    expect(await update(explorer, `alt_text = 'Cudzy'`)).toEqual([]);
    await expect(
      asGuest(`update public.place_photos set alt_text = 'x' where id = ?`, [id]),
    ).rejects.toThrow(/read-only/);

    for (const set of [
      `file_state = 'ready'`,
      `storage_key = gen_random_uuid()`,
      `width = 10`,
      `height = 10`,
      `fetch_attempts = 2`,
      `source_kind = 'own'`,
      `place_id = place_id`,
      `organization_id = organization_id`,
      `content_sha256 = decode(repeat('00', 32), 'hex')`,
    ]) {
      await expect(update(curA, set)).rejects.toThrow(noPermission);
    }

    const [row] = await admin$<{ alt_text: string; file_state: string }>(
      `select alt_text, file_state from public.place_photos where id = $1`,
      [id],
    );

    expect(row).toEqual({ alt_text: "Nowy opis", file_state: "pending_fetch" });
  });

  it("lets a member delete a row of the own organization and nobody else's", async () => {
    const placeId = await newPlace(orgA);
    const id = await photo(placeId, orgA, { state: "pending_fetch" });
    const remove = (actor: { id: string }) =>
      as(actor, `delete from public.place_photos where id = ? returning id`, [id]);

    expect(await remove(curB)).toEqual([]);
    expect(await remove(explorer)).toEqual([]);
    await expect(asGuest(`delete from public.place_photos where id = ?`, [id])).rejects.toThrow(
      /read-only/,
    );
    expect(await remove(curA)).toHaveLength(1);
  });

  it("deletes the rows with the place (cascade)", async () => {
    const placeId = await newPlace(orgA);

    await photo(placeId, orgA, { state: "pending_fetch" });
    await admin$(`delete from public.places where id = $1`, [placeId]);

    expect(
      await admin$(`select 1 from public.place_photos where place_id = $1`, [placeId]),
    ).toEqual([]);
  });

  it("lets ops set the file columns of a row from a file and nothing else", async () => {
    const placeId = await newPlace(orgA);
    const pending = await photo(placeId, orgA, { state: "pending_fetch" });
    const own = await photo(placeId, orgA, { kind: "own" });
    const key = randomUUID();

    const result = await ops$(
      `update public.place_photos
          set file_state = 'ready', storage_key = $2, width = 1280, height = 853,
              content_sha256 = decode(repeat('ab', 32), 'hex'), fetch_attempts = 0, updated_at = now()
        where id = $1 returning id`,
      [pending, key],
    );

    expect(result.rowCount).toBe(1);

    // A row that is not from a file is out of reach of ops.
    expect(
      (
        await ops$(`update public.place_photos set file_state = 'fetch_failed' where id = $1`, [
          own,
        ])
      ).rowCount,
    ).toBe(0);
    // No other column, no insert and no delete.
    await expect(
      ops$(`update public.place_photos set alt_text = 'x' where id = $1`, [pending]),
    ).rejects.toThrow(noPermission);
    await expect(
      ops$(`update public.place_photos set hidden_at = now() where id = $1`, [pending]),
    ).rejects.toThrow(noPermission);
    await expect(ops$(`delete from public.place_photos where id = $1`, [pending])).rejects.toThrow(
      noPermission,
    );
    await expect(ops$(`select alt_text from public.place_photos`)).rejects.toThrow(noPermission);
    await expect(ops$(`select rights_statement from public.place_photos`)).rejects.toThrow(
      noPermission,
    );
    const version = await ops$(
      `select retrieved_at, license_code from public.place_photos where id = $1`,
      [pending],
    );

    expect(version.rows).toHaveLength(1);
    expect(version.rows[0]).toHaveProperty("license_code");
    // The rows ops reads are those it needs to fetch.
    const list = await ops$(
      `select id, commons_file, source_width, fetch_attempts from public.place_photos where id = $1`,
      [pending],
    );

    expect(list.rows).toHaveLength(1);
  });

  it("refuses ready without a file or dimensions, and the same image twice in a place", async () => {
    const placeId = await newPlace(orgA);
    const id = await photo(placeId, orgA, { state: "pending_fetch" });
    const bytes = `decode(repeat('cd', 32), 'hex')`;

    await expect(
      ops$(`update public.place_photos set file_state = 'ready' where id = $1`, [id]),
    ).rejects.toThrow(/place_photos_ready_check/);

    const other = await photo(placeId, orgA, { state: "pending_fetch" });
    const ready = (photoId: string) =>
      ops$(
        `update public.place_photos set file_state = 'ready', storage_key = gen_random_uuid(),
                width = 10, height = 10, content_sha256 = ${bytes} where id = $1`,
        [photoId],
      );

    await ready(id);
    await expect(ready(other)).rejects.toMatchObject({ code: "23505" });
  });

  it("keeps the shape of a row: licence and address of the licence, texts, addresses, one file per place", async () => {
    const placeId = await newPlace(orgA);
    const insert = (overrides: Record<string, string | number | null>) =>
      insertPending(curA, orgA, placeId, { position: (counter += 100), ...overrides });

    // Address and code of the licence agree, a country only for 2.0–3.0.
    await expect(
      insert({
        license_code: "cc-by-sa-3.0",
        license_url: `${cc}/licenses/by-sa/3.0/pl/`,
        license_label: "CC BY-SA 3.0 PL",
      }),
    ).resolves.toHaveLength(1);
    await expect(
      insert({ license_code: "cc-by-sa-4.0", license_url: `${cc}/licenses/by-sa/4.0/pl/` }),
    ).rejects.toThrow(/license_url_check/);
    await expect(
      insert({ license_code: "cc-by-4.0", license_url: `${cc}/licenses/by-sa/4.0/` }),
    ).rejects.toThrow(/license_url_check/);
    await expect(
      insert({ license_code: "cc-by-4.0", license_url: `${cc}/licenses/by/4.0` }),
    ).rejects.toThrow(/license_url_check/);
    await expect(
      insert({ license_code: "cc-by-4.0", license_url: "https://example.com/licenses/by/4.0/" }),
    ).rejects.toThrow(/license_url_check/);
    await expect(
      insert({ license_code: "krajozbior_org_license", license_url: `${cc}/licenses/by/4.0/` }),
    ).rejects.toThrow(/license_url_check/);
    await expect(
      insert({ license_code: "cc-by-nc-4.0", license_url: `${cc}/licenses/by-nc/4.0/` }),
    ).rejects.toThrow(/license_code_check/);
    await expect(
      insert({
        license_code: "cc0-1.0",
        license_url: `${cc}/publicdomain/zero/1.0/`,
        license_label: "CC0 1.0",
      }),
    ).resolves.toHaveLength(1);
    await expect(
      insert({
        license_code: "public-domain",
        license_url: `${cc}/publicdomain/mark/1.0/`,
        license_label: "domena publiczna",
      }),
    ).resolves.toHaveLength(1);

    await expect(insert({ alt_text: "" })).rejects.toThrow(/alt_text_check/);
    await expect(insert({ alt_text: "a\nb" })).rejects.toThrow(/alt_text_check/);
    await expect(insert({ alt_text: "x".repeat(201) })).rejects.toThrow(/alt_text_check/);
    await expect(insert({ author_text: "" })).rejects.toThrow(/author_text_check/);
    await expect(
      insert({ source_url: "http://commons.wikimedia.org/wiki/File:A.jpg" }),
    ).rejects.toThrow(/source_url_check/);
    await expect(insert({ license_label: "" })).rejects.toThrow(/license_label_check/);
    await expect(insert({ commons_file: null })).rejects.toThrow(/place_photos_commons_check/);
    await expect(insert({ source_url: null })).rejects.toThrow(/place_photos_commons_check/);

    const same = `Ten sam ${randomUUID()}.jpg`;

    await insert({ commons_file: same });
    await expect(insert({ commons_file: same })).rejects.toMatchObject({ code: "23505" });
  });

  it("keeps the keys of the files readable only to ops, through the function and the owner policy", async () => {
    const placeId = await newPlace(orgA);
    const id = await photo(placeId, orgA);
    const [{ storage_key: key }] = await admin$<{ storage_key: string }>(
      `select storage_key from public.place_photos where id = $1`,
      [id],
    );

    const keys = await ops$(`select media_kind, storage_key from public.ops_media_keys()`);

    expect(keys.rows).toContainEqual({ media_kind: "p", storage_key: key });
    await expect(
      withClient(db.urls.krajozbior_app, (client) =>
        client.query(`select * from public.ops_media_keys()`),
      ),
    ).rejects.toThrow(noPermission);
    await expect(
      withClient(db.urls.krajozbior_auth, (client) =>
        client.query(`select * from public.ops_media_keys()`),
      ),
    ).rejects.toThrow(noPermission);
  });

  it("lets ops write the audit entry of the command, with numbers only, and nobody else", async () => {
    const entry = (role: "krajozbior_ops" | "krajozbior_app") =>
      withClient(db.urls[role], (client) =>
        client.query(
          `insert into public.operations_audit
             (operation, operator_label, outcome, reason, details)
           values ('photos_fetch', 'tester', 'applied', 'Test', $1::jsonb)`,
          [JSON.stringify({ phase: "finish", fetched: 3, failed: 0 })],
        ),
      );

    expect((await entry("krajozbior_ops")).rowCount).toBe(1);
    await expect(entry("krajozbior_app")).rejects.toThrow(noPermission);
    // `details` stays an object and only for the operations that carry it.
    await expect(
      withClient(db.urls.krajozbior_ops, (client) =>
        client.query(
          `insert into public.operations_audit (operation, operator_label, outcome, reason, details)
           values ('set_user_role', 'tester', 'applied', 'Test', '{}'::jsonb)`,
        ),
      ),
    ).rejects.toThrow(/operations_audit_details_check/);
  });

  it("does not leak the context of the previous transaction on the single connection", async () => {
    const placeId = await newPlace(orgA);

    await photo(placeId, orgA, { state: "pending_fetch" });
    expect(
      (await as(curA, `select id from public.place_photos where place_id = ?`, [placeId])).length,
    ).toBe(1);
    expect(
      await asGuest(`select id from public.place_photos where place_id = ?`, [placeId]),
    ).toEqual([]);
  });
});
