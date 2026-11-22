import { mkdtemp, readdir, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkFreeSpace } from "@/features/media/domain/free-space";
import { mediaFilePath } from "@/features/media/domain/media-key";
import { DiskMediaStorage } from "@/features/media/infrastructure/disk-media-storage";
import { processImageBytes } from "@/features/media/infrastructure/image-processor";
import {
  fetchCommonsPhotos,
  requeueMissingFiles,
  type PhotoFetchDeps,
} from "@/features/photos/application/fetch-photos";
import { runPhotosFetch } from "@/features/photos/application/photos-fetch-command";
import { commonsFileName } from "@/features/photos/domain/commons-url";
import type {
  CommonsVersionInfo,
  CommonsVersionLookup,
} from "@/features/photos/domain/commons-version";
import type { CommonsFetchResult } from "@/features/photos/infrastructure/commons-http";
import {
  createPostgresPhotoFetchRepository,
  releaseMediaLock,
  tryMediaLock,
} from "@/features/photos/infrastructure/postgres-photo-fetch-repository";
import { writeAuditEntry } from "@/lib/db/operations-audit";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { jpegWithMetadata } from "../support/photo-fixtures";

// `photos:fetch` on the real database as krajozbior_ops with a stand-in for the server of
// Wikimedia (no network): the address is built from the Commons file name, the files are processed
// by the real library of E4-0a (child process, sharp) and stored on a real directory. Every
// scenario has its own organization and place, and runs with `organizationSlug`, so the rows of
// the other scenarios do not mix in.
let db: ScratchDatabase;
let root: string;
let storage: DiskMediaStorage;
let ops: Client;
let big: Buffer;
let small: Buffer;
let counter = 0;
const sourceWidths = new Map<string, number | null>();

type Scope = { organizationId: string; placeId: string; slug: string };

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

const scope = async (): Promise<Scope> => {
  const slug = `gmina-${(counter += 1)}`;
  const [{ id: organizationId }] = await admin$<{ id: string }>(
    `insert into public.organizations (name, slug, kind) values ($1, $1, 'municipality') returning id`,
    [slug],
  );
  const [{ id: placeId }] = await admin$<{ id: string }>(
    `insert into public.places (organization_id, name, latitude, longitude)
     values ($1, 'Miejsce', 54.1, 18.7) returning id`,
    [organizationId],
  );

  return { organizationId, placeId, slug };
};

const pending = async (
  where: Scope,
  commonsFile: string,
  sourceWidth: number | null,
  kind = "commons_import",
) => {
  sourceWidths.set(commonsFile, sourceWidth);

  return (
    await admin$<{ id: string }>(
      `insert into public.place_photos
         (organization_id, place_id, position, file_state, alt_text, source_kind, author_text,
          source_url, license_code, license_url, license_label, rights_statement, commons_file,
          source_width, retrieved_at)
       values ($1, $2, $3, 'pending_fetch', 'Opis', $4, 'Autor',
               'https://commons.wikimedia.org/wiki/File:X.jpg', 'cc-by-sa-4.0',
               'https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0',
               'commons-import/1', $5, $6, '2026-11-20T00:00:00Z')
       returning id`,
      [where.organizationId, where.placeId, (counter += 1), kind, commonsFile, sourceWidth],
    )
  )[0]!.id;
};

// Stand-in for the API of Commons (no network): the current version is older than the day of the
// selection, with the same name, source width and licence as the row, unless a test says otherwise.
const currentVersion = (
  commonsFile: string,
  overrides: Partial<CommonsVersionInfo> = {},
): CommonsVersionLookup => ({
  ok: true,
  info: {
    timestamp: Date.parse("2026-01-02T03:04:05Z"),
    width: sourceWidths.get(commonsFile) ?? 0,
    licenseShort: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    fileName: commonsFileName(commonsFile),
    ...overrides,
  },
});

type Row = {
  id: string;
  file_state: string;
  storage_key: string | null;
  width: number | null;
  height: number | null;
  content_sha256: Buffer | null;
  fetch_attempts: number;
};

const row = async (id: string) =>
  (
    await admin$<Row>(
      `select id, file_state, storage_key, width, height, content_sha256, fetch_attempts
         from public.place_photos where id = $1`,
      [id],
    )
  )[0]!;

const urls: string[] = [];

function deps(
  responses: Record<string, CommonsFetchResult | Buffer>,
  overrides: Partial<PhotoFetchDeps> = {},
  client: Client = ops,
): PhotoFetchDeps {
  return {
    repository: createPostgresPhotoFetchRepository(client),
    download: async (address) => {
      urls.push(address);

      const found = Object.entries(responses).find(([part]) => address.includes(part))?.[1];

      if (found === undefined) {
        return { ok: false, reason: "http_error" };
      }

      return Buffer.isBuffer(found) ? { ok: true, bytes: new Uint8Array(found) } : found;
    },
    lookupVersion: async (commonsFile) => currentVersion(commonsFile),
    process: (bytes) =>
      processImageBytes(bytes, { tmpDirectory: storage.tmpDirectory, minShortSide: 0 }),
    storage,
    checkSpace: () => checkFreeSpace(() => storage.diskSpace(), 0),
    sleep: async () => undefined,
    ...overrides,
  };
}

describe("photos:fetch", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_photos_fetch");
    await db.migrate();
    root = await mkdtemp(join(tmpdir(), "krajozbior-photos-"));
    storage = new DiskMediaStorage(root);
    ops = new Client({ connectionString: db.urls.krajozbior_ops });
    await ops.connect();
    big = await jpegWithMetadata({ width: 2400, height: 1600 });
    small = await jpegWithMetadata({ width: 300, height: 200 });
  }, 60_000);

  afterAll(async () => {
    await ops?.end();
    await db?.drop();
    await rm(root, { recursive: true, force: true });
  });

  it("builds the address from the file name, processes the image and stores only the result", async () => {
    const where = await scope();
    const good = await pending(where, "Duże zdjęcie (1).jpg", 3000);
    const tiny = await pending(where, "Małe zdjęcie.jpg", 700);
    const broken = await pending(where, "Brak pliku.jpg", 3000);

    const report = await fetchCommonsPhotos(
      deps({
        "Du%C5%BCe_zdj%C4%99cie_%281%29.jpg": big,
        "Ma%C5%82e_zdj%C4%99cie.jpg": small,
      }),
      { organizationSlug: where.slug },
    );

    // The thumbnail width is the largest standard step not above min(1920, width).
    expect(urls.filter((url) => url.includes("/1920px-Du%C5%BCe"))).toHaveLength(1);
    expect(urls.filter((url) => url.includes("/500px-Ma%C5%82e"))).toHaveLength(1);
    expect(urls.every((url) => url.startsWith("https://upload.wikimedia.org/"))).toBe(true);
    expect(report).toMatchObject({ fetched: 2, failed: 1, skipped: 0, reasons: { http_error: 1 } });

    const ready = await row(good);

    expect(ready).toMatchObject({ file_state: "ready", fetch_attempts: 0 });
    expect(ready.storage_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(ready.content_sha256).toHaveLength(32);
    expect(Math.max(ready.width!, ready.height!)).toBeLessThanOrEqual(1600);

    const main = join(root, mediaFilePath("place", ready.storage_key!, "main"));

    expect((await stat(main)).size).toBeLessThanOrEqual(300 * 1024);
    expect(
      (await stat(join(root, mediaFilePath("place", ready.storage_key!, "w400")))).isFile(),
    ).toBe(true);

    // A picture under 600 px is accepted for Commons and is not enlarged.
    expect(await row(tiny)).toMatchObject({ file_state: "ready", width: 300, height: 200 });
    expect(await row(broken)).toMatchObject({ file_state: "pending_fetch", fetch_attempts: 1 });

    // The downloaded file does not stay: the input directory holds no input files.
    expect((await readdir(storage.tmpDirectory)).filter((name) => name.endsWith(".in"))).toEqual(
      [],
    );
  });

  it("ends a row as fetch_failed after the third failed attempt, and retries it on request", async () => {
    const where = await scope();
    const id = await pending(where, "Zawsze błąd.jpg", 3000);
    const failing = deps({});
    const options = { organizationSlug: where.slug };

    await fetchCommonsPhotos(failing, options);
    expect(await row(id)).toMatchObject({ file_state: "pending_fetch", fetch_attempts: 1 });
    await fetchCommonsPhotos(failing, options);
    expect(await row(id)).toMatchObject({ file_state: "pending_fetch", fetch_attempts: 2 });
    await fetchCommonsPhotos(failing, options);
    expect(await row(id)).toMatchObject({ file_state: "fetch_failed", fetch_attempts: 3 });

    // Not picked up again without the switch.
    expect((await fetchCommonsPhotos(failing, options)).failed).toBe(0);
    expect(await row(id)).toMatchObject({ fetch_attempts: 3 });

    const report = await fetchCommonsPhotos(deps({ "Zawsze_b%C5%82%C4%85d.jpg": big }), {
      ...options,
      retryFailed: true,
    });

    expect(report.fetched).toBe(1);
    expect(await row(id)).toMatchObject({ file_state: "ready" });
  });

  it("refuses content that is not JPEG or PNG (a WebP) and counts the reason", async () => {
    const where = await scope();
    const id = await pending(where, "Plik webp.jpg", 3000);
    const webp = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .webp()
      .toBuffer();
    const report = await fetchCommonsPhotos(deps({ "Plik_webp.jpg": webp }), {
      organizationSlug: where.slug,
    });

    expect(report.reasons).toEqual({ unsupported_type: 1 });
    expect(await row(id)).toMatchObject({ file_state: "pending_fetch", fetch_attempts: 1 });
  });

  it("reads the day of the selection and the licence of the row as ops, and rejects a newer version without a file", async () => {
    const where = await scope();
    const newer = await pending(where, "Nowsza wersja.jpg", 3000);
    const other = await pending(where, "Inna licencja.jpg", 3000);
    const gone = await pending(where, "Zniknął z Commons.jpg", 3000);
    const same = await pending(where, "Ta sama wersja.jpg", 3000);
    const lookups: string[] = [];
    const report = await fetchCommonsPhotos(
      deps(
        {
          "Nowsza_wersja.jpg": big,
          "Inna_licencja.jpg": big,
          "Zniknął_z_Commons.jpg": big,
          "Ta_sama_wersja.jpg": big,
        },
        {
          lookupVersion: async (commonsFile) => {
            lookups.push(commonsFile);

            if (commonsFile.startsWith("Nowsza")) {
              // One second after the midnight of the day the selection was prepared.
              return currentVersion(commonsFile, { timestamp: Date.parse("2026-11-20T00:00:01Z") });
            }

            if (commonsFile.startsWith("Inna")) {
              return currentVersion(commonsFile, {
                licenseShort: "CC BY 4.0",
                licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
              });
            }

            if (commonsFile.startsWith("Zniknął")) {
              return { ok: false, reason: "file_gone" };
            }

            return currentVersion(commonsFile);
          },
        },
      ),
      { organizationSlug: where.slug },
    );

    // Four rows read through the real column grant (retrieved_at, license_code) and checked.
    expect(lookups).toHaveLength(4);
    expect(report).toMatchObject({
      fetched: 1,
      failed: 3,
      reasons: { file_changed: 1, license_changed: 1, file_gone: 1 },
    });
    // Only the row with the same version got a thumbnail; the rest ended for good, with no file.
    expect(urls.filter((url) => /Nowsza_wersja|Inna_licencja|_z_Commons/.test(url))).toEqual([]);
    expect(urls.filter((url) => url.includes("Ta_sama_wersja"))).toHaveLength(1);
    expect(await row(newer)).toMatchObject({
      file_state: "fetch_failed",
      fetch_attempts: 1,
      storage_key: null,
    });
    expect(await row(other)).toMatchObject({ file_state: "fetch_failed", storage_key: null });
    expect(await row(gone)).toMatchObject({ file_state: "fetch_failed", storage_key: null });
    expect(await row(same)).toMatchObject({ file_state: "ready" });
  });

  it("blocks a row whose day of the selection is unknown", async () => {
    const where = await scope();
    const id = await pending(where, "Bez daty doboru.jpg", 3000);

    await admin$(`update public.place_photos set retrieved_at = null where id = $1`, [id]);

    const report = await fetchCommonsPhotos(deps({ "Bez_daty_doboru.jpg": big }), {
      organizationSlug: where.slug,
    });

    expect(report.reasons).toEqual({ file_changed: 1 });
    expect(await row(id)).toMatchObject({ file_state: "fetch_failed", storage_key: null });
  });

  it("does not touch rows that are not from a file", async () => {
    const where = await scope();
    const own = await pending(where, "Własne.jpg", 3000, "own");
    const report = await fetchCommonsPhotos(deps({ "W%C5%82asne.jpg": big }), {
      organizationSlug: where.slug,
    });

    expect(report.fetched).toBe(0);
    expect(await row(own)).toMatchObject({ file_state: "pending_fetch" });
  });

  it("ends a duplicate image of the same place for good", async () => {
    const where = await scope();
    const first = await pending(where, "Duplikat A.jpg", 3000);
    const second = await pending(where, "Duplikat B.jpg", 3000);
    const report = await fetchCommonsPhotos(
      deps({ "Duplikat_A.jpg": big, "Duplikat_B.jpg": big }),
      { organizationSlug: where.slug },
    );

    expect(report).toMatchObject({ fetched: 1, failed: 1, reasons: { duplicate: 1 } });
    expect([(await row(first)).file_state, (await row(second)).file_state].sort()).toEqual([
      "fetch_failed",
      "ready",
    ]);
  });

  it("goes on when a row disappears during the download, and leaves no file behind", async () => {
    const where = await scope();
    const vanishing = await pending(where, "Zniknie.jpg", 3000);
    const staying = await pending(where, "Zostanie.jpg", 3000);
    const base = deps({ "Zostanie.jpg": big });
    const report = await fetchCommonsPhotos(
      {
        ...base,
        download: async (address) => {
          if (address.includes("Zniknie")) {
            await admin$(`delete from public.place_photos where id = $1`, [vanishing]);

            return { ok: true, bytes: new Uint8Array(big) };
          }

          return base.download(address);
        },
      },
      { organizationSlug: where.slug },
    );

    expect(report).toMatchObject({ fetched: 1, failed: 1, reasons: { gone: 1 } });
    expect((await row(staying)).file_state).toBe("ready");
  });

  it("pauses without writing when the disk is short of space", async () => {
    const where = await scope();
    const id = await pending(where, "Bez miejsca.jpg", 3000);
    const report = await fetchCommonsPhotos(
      deps(
        { "Bez_miejsca.jpg": big },
        { checkSpace: async () => ({ ok: false, reason: "space_unreadable" }) },
      ),
      { organizationSlug: where.slug },
    );

    expect(report).toMatchObject({ fetched: 0, skipped: 1, stoppedBy: "space_unreadable" });
    expect(await row(id)).toMatchObject({ file_state: "pending_fetch", fetch_attempts: 0 });
  });

  it("puts a row whose file vanished back to pending (--refetch-missing)", async () => {
    const where = await scope();
    const id = await pending(where, "Zniknie.jpg", 3000);

    await fetchCommonsPhotos(deps({ "Zniknie.jpg": big }), { organizationSlug: where.slug });

    const ready = await row(id);

    expect(ready.file_state).toBe("ready");
    await unlink(join(root, mediaFilePath("place", ready.storage_key!, "main")));

    expect(
      await requeueMissingFiles(createPostgresPhotoFetchRepository(ops), storage),
    ).toBeGreaterThanOrEqual(1);
    expect(await row(id)).toMatchObject({
      file_state: "pending_fetch",
      storage_key: null,
      width: null,
      content_sha256: null,
      fetch_attempts: 0,
    });
  });

  it("takes one advisory lock for the whole command: a second run does not start", async () => {
    const other = new Client({ connectionString: db.urls.krajozbior_ops });

    await other.connect();

    try {
      expect(await tryMediaLock(ops)).toBe(true);
      expect(await tryMediaLock(other)).toBe(false);
      await releaseMediaLock(ops);
      expect(await tryMediaLock(other)).toBe(true);
      await releaseMediaLock(other);
    } finally {
      await other.end();
    }
  });

  it("runs as a command: lock, fetching, one audit entry with numbers only", async () => {
    const where = await scope();
    const id = await pending(where, "Przez polecenie.jpg", 3000);
    const before = (
      await admin$<{ n: number }>(
        `select count(*)::int as n from public.operations_audit where operation = 'photos_fetch'`,
      )
    )[0]!.n;
    const session = new Client({ connectionString: db.urls.krajozbior_ops });

    await session.connect();

    const output = await runPhotosFetch(
      [
        "--operator",
        "wlasciciel",
        "--reason",
        "Pobranie zdjec z Commons",
        "--limit",
        "500",
        "--org-slug",
        where.slug,
      ],
      {
        openSession: async () => ({
          session: {
            tryLock: () => tryMediaLock(session),
            writeAudit: async (entry) => {
              await writeAuditEntry(session, entry);
            },
            close: async () => {
              await releaseMediaLock(session);
              await session.end();
            },
          },
          fetch: deps({ "Przez_polecenie.jpg": big }, {}, session),
        }),
      },
    );

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout[0]!)).toMatchObject({ outcome: "applied", fetched: 1 });
    expect(await row(id)).toMatchObject({ file_state: "ready" });

    const entries = await admin$<{
      details: Record<string, unknown>;
      operator_label: string;
    }>(
      `select details, operator_label from public.operations_audit
        where operation = 'photos_fetch' order by occurred_at desc`,
    );

    expect(entries).toHaveLength(before + 1);
    expect(entries[0]).toMatchObject({
      operator_label: "wlasciciel",
      details: { phase: "finish", fetched: 1 },
    });
    expect(JSON.stringify(entries[0]!.details)).not.toMatch(/jpg|wikimedia|Przez/);
  });
});
