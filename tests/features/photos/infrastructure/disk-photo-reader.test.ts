import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDiskPhotoReader } from "@/features/photos/infrastructure/disk-photo-reader";

const KEY = "5a6b7c8d-1111-4222-8333-444455556666";
let root = "";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "kz-photo-reader-"));
  mkdirSync(join(root, "p", "5a", KEY), { recursive: true });
  writeFileSync(join(root, "p", "5a", KEY, "main.webp"), "main-bytes");
  // `w400.webp` is a directory: it must not be served as a file.
  mkdirSync(join(root, "p", "5a", KEY, "w400.webp"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createDiskPhotoReader og size (E4-3)", () => {
  it("serves the og file that photos:fetch made, as it is", async () => {
    const key = "7c8d9e0f-2222-4333-8444-555566667777";
    const directory = join(root, "p", "7c", key);

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "main.webp"), "main-bytes");
    writeFileSync(join(directory, "og.jpg"), "og-bytes");

    const file = await createDiskPhotoReader(root).open(key, "og");

    expect(file?.length).toBe(8);
    expect(await readAll(file!.body)).toBe("og-bytes");
  });

  it("is null when there is no og file, and never makes one from the main file (S1)", async () => {
    const key = "9e0f1a2b-4444-4555-8666-777788889999";
    const directory = join(root, "p", "9e", key);

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "main.webp"), "main-bytes");

    const reader = createDiskPhotoReader(root);

    expect(await reader.open(key, "og")).toBeNull();
    expect(await reader.open(key, "og")).toBeNull();
    expect(existsSync(join(directory, "og.jpg"))).toBe(false);
    expect(readdirSync(directory)).toEqual(["main.webp"]);
  });

  it("is null for an og file of zero length (an interrupted write), and for a missing photo", async () => {
    const key = "ab0f1a2b-5555-4666-8777-88889999aaaa";

    mkdirSync(join(root, "p", "ab", key), { recursive: true });
    writeFileSync(join(root, "p", "ab", key, "og.jpg"), "");

    const reader = createDiskPhotoReader(root);

    expect(await reader.open(key, "og")).toBeNull();
    expect(await reader.open("bc1f2a3b-6666-4777-8888-9999aaaabbbb", "og")).toBeNull();
  });
});

describe("createDiskPhotoReader", () => {
  it("streams the file with its length", async () => {
    const file = await createDiskPhotoReader(root).open(KEY, "main");

    expect(file?.length).toBe(10);
    expect(await readAll(file!.body)).toBe("main-bytes");
  });

  it("returns null for a missing file, a missing root and a directory", async () => {
    const reader = createDiskPhotoReader(root);

    expect(await createDiskPhotoReader(join(root, "nie-ma")).open(KEY, "main")).toBeNull();
    expect(await reader.open("11111111-1111-4111-8111-111111111111", "main")).toBeNull();
    expect(await reader.open(KEY, "w400")).toBeNull();
  });

  it("builds the path only from a canonical UUID key", async () => {
    const reader = createDiskPhotoReader(root);

    expect(await reader.open("../../../etc/passwd", "main")).toBeNull();
    expect(await reader.open(KEY.toUpperCase(), "main")).toBeNull();
    expect(await reader.open(`${KEY}/../${KEY}`, "main")).toBeNull();
  });
});
