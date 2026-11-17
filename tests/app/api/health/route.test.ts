import { beforeEach, describe, expect, it, vi } from "vitest";

const checkDatabaseConnection = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

vi.mock("@/lib/db/health", () => ({ checkDatabaseConnection }));

const { GET } = await import("@/app/api/health/route");

describe("GET /api/health", () => {
  beforeEach(() => {
    checkDatabaseConnection.mockReset();
  });

  it("returns 200 with a status only when the database answers", async () => {
    checkDatabaseConnection.mockResolvedValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 503 without any details when the database is unavailable", async () => {
    checkDatabaseConnection.mockResolvedValue(false);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
