import { describe, expect, it } from "vitest";

import { createSearchGate } from "@/features/catalog/application/search-gate";

function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });

  return { promise, finish };
}

describe("createSearchGate", () => {
  it("runs at most `max` at once and answers null to a request that waits too long", async () => {
    const gate = createSearchGate(2, 30);
    const first = deferred();
    const second = deferred();
    const a = gate.run(async () => (await first.promise, "a"));
    const b = gate.run(async () => (await second.promise, "b"));

    expect(gate.state().active).toBe(2);
    expect(await gate.run(async () => "c")).toBeNull();
    expect(gate.state()).toEqual({ active: 2, waiting: 0 });

    first.finish();
    second.finish();
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(gate.state().active).toBe(0);
  });

  it("passes a freed place to a waiting request", async () => {
    const gate = createSearchGate(1, 1000);
    const first = deferred();
    const a = gate.run(async () => (await first.promise, "a"));
    const b = gate.run(async () => "b");

    expect(gate.state()).toEqual({ active: 1, waiting: 1 });
    first.finish();
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(gate.state()).toEqual({ active: 0, waiting: 0 });
  });

  it("frees the place when the work fails", async () => {
    const gate = createSearchGate(1, 10);

    await expect(
      gate.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await gate.run(async () => "ok")).toBe("ok");
  });
});
