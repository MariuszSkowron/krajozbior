import { describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("node:fs/promises", () => ({ open: fs.open }));
vi.mock("@/lib/log-failure", () => ({ logFailure: vi.fn() }));

import { createDiskPhotoReader } from "@/features/photos/infrastructure/disk-photo-reader";

const KEY = "5a6b7c8d-1111-4222-8333-444455556666";

describe("createDiskPhotoReader, a file handle whose stat() fails", () => {
  it("closes the handle and answers null (404), so no descriptor leaks", async () => {
    const close = vi.fn(async () => undefined);

    fs.open.mockResolvedValue({
      stat: async () => {
        throw new Error("EIO");
      },
      close,
    });

    expect(await createDiskPhotoReader("/media-root").open(KEY, "main")).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
