import { describe, expect, it, vi } from "vitest";

const getDeps = vi.hoisted(() => vi.fn());

vi.mock("@/features/photos/infrastructure/photo-deps", () => ({ getPhotoDeps: getDeps }));

import { handleMediaRequest } from "@/features/photos/http/media-http";

const ID = "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b";
const request = () => new Request(`http://localhost/media/p/${ID}/main`);

describe("handleMediaRequest", () => {
  it("answers a bad address with the uncacheable 404 and never builds the dependencies", async () => {
    for (const parts of [
      { kind: "e", photoId: ID, size: "main" },
      { kind: "p", photoId: "..", size: "main" },
      { kind: "p", photoId: ID.toUpperCase(), size: "main" },
      { kind: "p", photoId: ID, size: "og" },
    ]) {
      const response = await handleMediaRequest(request(), parts);

      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).toBe("Nie znaleziono.");
    }

    expect(getDeps).not.toHaveBeenCalled();
  });

  it("answers 503 without details when the database fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    getDeps.mockReturnValue({
      withGuestContext: async () => {
        throw new Error("connection string postgres://secret");
      },
    });

    const response = await handleMediaRequest(request(), { kind: "p", photoId: ID, size: "main" });
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).not.toContain("secret");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("secret");
    spy.mockRestore();
  });
});
