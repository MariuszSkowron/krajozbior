import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MikroORM } from "@mikro-orm/postgresql";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { getPublishedPlace } from "@/features/catalog/application/public-catalog";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import type { PhotoDeps } from "@/features/photos/application/serve-photo";
import { createDiskPhotoReader } from "@/features/photos/infrastructure/disk-photo-reader";
import { postgresPhotoReadRepository } from "@/features/photos/infrastructure/postgres-photo-read-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import { config as proxyConfig } from "@/proxy";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// E4-2b: GET /media/p/{photoId}/{main|w400} through the real route, the real use case, the real
// repository, the real disk reader and the real row-level security of `place_photos` (class:
// public once the place lies in a published collection of an approved organization and the photo
// is ready and not hidden, otherwise CUR). Only the session comes from the test. The app role
// runs on a pool of one connection, so a context leaked from a curator read would show.
const state = vi.hoisted(() => ({
  session: null as { id: string; role: "user" | "admin" } | null,
  deps: null as unknown as () => import("@/features/photos/application/serve-photo").PhotoDeps,
  guestReads: 0,
}));

vi.mock("@/features/photos/infrastructure/photo-deps", () => ({
  getPhotoDeps: () => state.deps(),
}));

let db: ScratchDatabase;
let app: MikroORM;
let mediaRoot = "";
let route: typeof import("@/app/media/[[...parts]]/route");

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("pr-cur-a");
const curB = user("pr-cur-b");
const explorer = user("pr-explorer");
const admin = user("pr-admin");

let orgA = "";
let orgB = "";
let counter = 0;

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

const bytesOf = (key: string, size: string) => Buffer.from(`webp:${size}:${key}`);

const newPlace = async (organizationId: string) =>
  (
    await admin$<{ id: string }>(
      `insert into public.places (organization_id, name, latitude, longitude)
       values ($1, 'Miejsce', 54.1, 18.7) returning id`,
      [organizationId],
    )
  )[0]!.id;

// A collection with the place; published only after the link (the trigger demands a place).
const collectionWith = async (placeId: string, organizationId: string, published: boolean) => {
  const [{ id }] = await admin$<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, region, status)
     values ($1, $2, 'Kolekcja', 'pomorskie', 'draft') returning id`,
    [`zdjecia-${(counter += 1)}`, organizationId],
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

type PhotoRow = { state?: "ready" | "pending_fetch"; hidden?: boolean; withFiles?: boolean };

// A photo row made by the superuser (the policies let no role write most of these columns), with
// its two files on disk unless `withFiles` is false.
const photo = async (placeId: string, organizationId: string, row: PhotoRow = {}) => {
  const state_ = row.state ?? "ready";
  const key = randomUUID();
  const n = (counter += 1);
  const [{ id }] = await admin$<{ id: string }>(
    `insert into public.place_photos
       (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
        source_kind, author_text, source_url, license_code, license_url, license_label,
        rights_statement, commons_file, hidden_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'Opis', 'commons_import', 'Autor',
             'https://commons.wikimedia.org/wiki/File:X.jpg', 'cc-by-sa-4.0',
             'https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0',
             'commons-import/1', $8, $9)
     returning id`,
    [
      organizationId,
      placeId,
      n,
      state_,
      state_ === "ready" ? key : null,
      state_ === "ready" ? 1280 : null,
      state_ === "ready" ? 853 : null,
      `Plik ${n}.jpg`,
      row.hidden === true ? new Date().toISOString() : null,
    ],
  );

  if (state_ === "ready" && row.withFiles !== false) {
    const directory = join(mediaRoot, "p", key.slice(0, 2), key);

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "main.webp"), bytesOf(key, "main"));
    writeFileSync(join(directory, "w400.webp"), bytesOf(key, "w400"));
  }

  return { id, key };
};

// The route is an optional catch-all: the segments after `/media` arrive as `parts` (none for
// `/media` itself).
const getParts = (parts: string[], headers: Record<string, string> = {}) =>
  route.GET(new Request(`http://localhost/media/${parts.join("/")}`, { headers }), {
    params: Promise.resolve({ parts: parts.length === 0 ? undefined : parts }),
  });

const get = (photoId: string, size = "main", kind = "p", headers: Record<string, string> = {}) =>
  getParts([kind, photoId, size], headers);

const asCuratorA = () => (state.session = { id: curA.id, role: "user" });
const asGuest = () => (state.session = null);

// What a refusal looks like: the same for a draft, another organization, a missing photo and a
// bad address, so nothing tells which of them it was.
async function expectNotFound(response: Response) {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  expect(response.headers.has("etag")).toBe(false);
  expect(await response.text()).toBe("Nie znaleziono.");
}

describe("GET /media/p/{photoId}/{size}", () => {
  let publicPhoto: { id: string; key: string };
  let draftPhoto: { id: string; key: string };

  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_photo_routes");
    await db.migrate();
    mediaRoot = mkdtempSync(join(tmpdir(), "kz-photo-routes-"));

    for (const { id, email } of [curA, curB, explorer, admin]) {
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

    orgA = await org("gmina-zdjec-a", curA);
    orgB = await org("gmina-zdjec-b", curB);

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
    state.deps = (): PhotoDeps => ({
      withGuestContext: (work) => {
        state.guestReads += 1;

        return runInGuestContext(app.em, work);
      },
      withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
      getActor: async () => state.session,
      repository: postgresPhotoReadRepository,
      files: createDiskPhotoReader(mediaRoot),
    });
    route = await import("@/app/media/[[...parts]]/route");

    const publicPlace = await newPlace(orgA);

    await collectionWith(publicPlace, orgA, true);
    publicPhoto = await photo(publicPlace, orgA);

    const draftPlace = await newPlace(orgA);

    await collectionWith(draftPlace, orgA, false);
    draftPhoto = await photo(draftPlace, orgA);
  }, 90_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
    rmSync(mediaRoot, { recursive: true, force: true });
  });

  it("serves the photo of a published collection to a guest as public, for a day", async () => {
    asGuest();

    const response = await get(publicPhoto.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe("inline");
    // One policy, the one of the photo (the page policy would let a script run in the frame).
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(await response.arrayBuffer()).equals(bytesOf(publicPhoto.key, "main"))).toBe(
      true,
    );
  });

  it("serves the thumbnail and gives the two sizes different ETags that do not show the file key", async () => {
    asGuest();

    const main = await get(publicPhoto.id, "main");
    const thumb = await get(publicPhoto.id, "w400");

    expect(thumb.status).toBe(200);
    expect(Buffer.from(await thumb.arrayBuffer()).equals(bytesOf(publicPhoto.key, "w400"))).toBe(
      true,
    );
    expect(main.headers.get("etag")).toMatch(/^"[0-9a-f]{16}"$/);
    expect(main.headers.get("etag")).not.toBe(thumb.headers.get("etag"));
    expect(main.headers.get("etag")).not.toContain(publicPhoto.key);
  });

  it("answers 304 with the same cache headers when the ETag matches", async () => {
    asGuest();

    const etag = (await get(publicPhoto.id)).headers.get("etag")!;
    const response = await get(publicPhoto.id, "main", "p", { "if-none-match": etag });

    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("etag")).toBe(etag);
    expect(await response.text()).toBe("");
  });

  it("keeps public for a signed-in curator: the guest read decides, not the session", async () => {
    asCuratorA();

    const response = await get(publicPhoto.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("refuses a draft photo to a guest, with the same 404 as a photo that does not exist", async () => {
    asGuest();

    const draft = await get(draftPhoto.id);
    const missing = await get(randomUUID());

    await expectNotFound(draft);
    await expectNotFound(missing);
  });

  it("answers 404, not 304, for a draft photo even when the client sends a matching ETag", async () => {
    asGuest();
    asCuratorA();

    const etag = (await get(draftPhoto.id)).headers.get("etag")!;

    asGuest();
    await expectNotFound(await get(draftPhoto.id, "main", "p", { "if-none-match": etag }));
  });

  it("refuses a draft photo to the curator of another organization, to an explorer and to an admin", async () => {
    for (const session of [
      { id: curB.id, role: "user" as const },
      { id: explorer.id, role: "user" as const },
      { id: admin.id, role: "admin" as const },
    ]) {
      state.session = session;
      await expectNotFound(await get(draftPhoto.id));
    }
  });

  it("serves a draft photo to the curator of its organization, privately", async () => {
    asCuratorA();

    const response = await get(draftPhoto.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(await response.arrayBuffer()).equals(bytesOf(draftPhoto.key, "main"))).toBe(
      true,
    );

    const etag = response.headers.get("etag")!;
    const revalidated = await get(draftPhoto.id, "main", "p", { "if-none-match": etag });

    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not let a context leak: the next guest read after a curator read sees nothing", async () => {
    asCuratorA();
    expect((await get(draftPhoto.id)).status).toBe(200);
    asGuest();
    await expectNotFound(await get(draftPhoto.id));
  });

  it("hides a hidden photo and one that is not ready from a guest, and a not ready one from everybody", async () => {
    const place = await newPlace(orgA);

    await collectionWith(place, orgA, true);

    const hidden = await photo(place, orgA, { hidden: true });
    const pending = await photo(place, orgA, { state: "pending_fetch" });

    asGuest();
    await expectNotFound(await get(hidden.id));
    await expectNotFound(await get(pending.id));
    asCuratorA();
    expect((await get(hidden.id)).headers.get("cache-control")).toBe("private, no-store");
    await expectNotFound(await get(pending.id));
  });

  it("answers 404 with no-store, never 500, when the file is missing on disk", async () => {
    const place = await newPlace(orgA);

    await collectionWith(place, orgA, true);

    const withoutFile = await photo(place, orgA, { withFiles: false });

    asGuest();
    await expectNotFound(await get(withoutFile.id));
  });

  it("answers 404 with no-store, never 500, when the server has no MEDIA_ROOT", async () => {
    const original = state.deps;

    state.deps = () => ({ ...original(), files: null });
    asGuest();
    try {
      await expectNotFound(await get(publicPhoto.id));
    } finally {
      state.deps = original;
    }
  });

  it("refuses an explorer photo address until E4-4", async () => {
    asGuest();
    await expectNotFound(await get(publicPhoto.id, "main", "e"));
  });

  it.each([
    ["traversal", ".."],
    ["encoded traversal", "%2e%2e"],
    ["decoded traversal in the middle", "../../etc/passwd"],
    ["encoded slash", "a%2fb"],
    ["upper case UUID", "0B6F3A52-7C41-4B7E-9D0A-1C2D3E4F5A6B"],
    ["longer than 64 characters", "a".repeat(65)],
    ["very long", "0".repeat(2000)],
    ["empty", ""],
  ])("answers 404 without a database read for a photo id with %s", async (_name, photoId) => {
    asGuest();
    state.guestReads = 0;

    await expectNotFound(await get(photoId));
    expect(state.guestReads).toBe(0);
  });

  it.each(["og", "w800", "MAIN", "main.webp", "..", "%2e%2e", "a".repeat(65), ""])(
    "answers 404 without a database read for the size %j",
    async (size) => {
      asGuest();
      state.guestReads = 0;

      await expectNotFound(await get(publicPhoto.id, size));
      expect(state.guestReads).toBe(0);
    },
  );

  it.each([[[]], [["p", "x"]], [["a"]], [["a", "b", "c", "d"]], [["p", "x", "main", "y"]]])(
    "answers the same plain 404 with a sandbox policy for the address /media/%j (wrong number of segments), without a database read",
    async (parts) => {
      asGuest();
      state.guestReads = 0;

      const response = await getParts(parts);

      await expectNotFound(response);
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(state.guestReads).toBe(0);
    },
  );

  it("is left out of the proxy under media/, which would overwrite the cache header of every photo", () => {
    for (const url of [
      `/media/p/${publicPhoto.id}/main`,
      `/media/p/${publicPhoto.id}/w400`,
      "/media/e/x/main",
      "/media/a/b/c/d",
    ]) {
      expect(unstable_doesMiddlewareMatch({ config: proxyConfig, url }), url).toBe(false);
    }

    // `/media` itself and a page whose name only starts with `media` still go through the proxy.
    for (const url of ["/media", "/media-kit"]) {
      expect(unstable_doesMiddlewareMatch({ config: proxyConfig, url }), url).toBe(true);
    }
  });

  // The same database, organizations and files as above (one `beforeAll`, one `afterAll`).
  describe("the cover of a place on its public page (findPublishedPlace)", () => {
    const catalogDeps = (): CatalogDeps => ({
      withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
      withGuestContext: (work) => runInGuestContext(app.em, work),
      limiter: { reserve: async () => ({ allowed: true }) },
      repository: postgresCatalogRepository,
      random: (max) => randomInt(max),
    });

    const coverOf = async (placeId: string) => {
      const result = await getPublishedPlace(placeId, catalogDeps());

      return result.status === "ok" ? result.value.cover : "not_found";
    };

    it("returns the first ready photo with its credit, and null when there is none", async () => {
      const place = await newPlace(orgA);

      await collectionWith(place, orgA, true);
      expect(await coverOf(place)).toBeNull();

      const first = await photo(place, orgA, { withFiles: false });

      await photo(place, orgA, { withFiles: false });
      expect(await coverOf(place)).toEqual({
        photoId: first.id,
        width: 1280,
        height: 853,
        altText: "Opis",
        title: null,
        authorText: "Autor",
        authorUrl: null,
        sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
        sourceKind: "commons_import",
        licenseCode: "cc-by-sa-4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        licenseLabel: "CC BY-SA 4.0",
      });
    });

    it("skips a hidden photo and one that is not ready, so the next public photo is the cover", async () => {
      const place = await newPlace(orgA);

      await collectionWith(place, orgA, true);
      await photo(place, orgA, { hidden: true, withFiles: false });
      await photo(place, orgA, { state: "pending_fetch" });

      const visible = await photo(place, orgA, { withFiles: false });

      expect(await coverOf(place)).toMatchObject({ photoId: visible.id });
    });

    it("gives no cover, and not even the page, for a place that is only in a draft collection", async () => {
      const place = await newPlace(orgB);

      await collectionWith(place, orgB, false);
      await photo(place, orgB, { withFiles: false });
      expect(await coverOf(place)).toBe("not_found");
    });
  });
});
