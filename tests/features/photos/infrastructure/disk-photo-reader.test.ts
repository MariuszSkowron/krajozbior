import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
