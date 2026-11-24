import { describe, expect, it } from "vitest";

import { bannerRandom, pickHomeBanner } from "@/features/catalog/domain/home-banner";
import { HOME_BANNER_POOL } from "@/features/catalog/domain/home-banner-pool";

describe("bannerRandom", () => {
  it("stays within [0, 1)", () => {
    for (let i = 0; i < 1000; i += 1) {
      const value = bannerRandom();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is the default draw of pickHomeBanner", () => {
    expect(["a", "b"]).toContain(pickHomeBanner(["a", "b"]));
  });
});

describe("pickHomeBanner", () => {
  it("gives null for an empty list", () => {
    expect(pickHomeBanner([], () => 0.5)).toBeNull();
  });

  it("picks evenly: each third of [0, 1) gives the next candidate", () => {
    const list = ["a", "b", "c"];

    expect(pickHomeBanner(list, () => 0)).toBe("a");
    expect(pickHomeBanner(list, () => 0.32)).toBe("a");
    expect(pickHomeBanner(list, () => 0.34)).toBe("b");
    expect(pickHomeBanner(list, () => 0.67)).toBe("c");
    expect(pickHomeBanner(list, () => 0.999999)).toBe("c");
  });

  it("stays inside the list for a draw outside [0, 1)", () => {
    const list = ["a", "b"];

    expect(pickHomeBanner(list, () => 1)).toBe("b");
    expect(pickHomeBanner(list, () => -0.5)).toBe("a");
    expect(pickHomeBanner(list, () => Number.NaN)).toBe("a");
  });

  it("gives null when the drawn slot holds no value", () => {
    expect(pickHomeBanner<string | undefined>([undefined], () => 0)).toBeNull();
    expect(pickHomeBanner<string | undefined>(["a", undefined], () => 0.9)).toBeNull();
  });

  it("draws with Math.random by default", () => {
    expect(["a", "b"]).toContain(pickHomeBanner(["a", "b"]));
  });
});

describe("home banner pool", () => {
  it("has at least ten places, each QID once, and every crop as object-position", () => {
    const qids = HOME_BANNER_POOL.map(({ qid }) => qid);

    expect(qids.length).toBeGreaterThanOrEqual(10);
    expect(new Set(qids).size).toBe(qids.length);

    for (const { qid, focus } of HOME_BANNER_POOL) {
      expect(qid).toMatch(/^Q[0-9]+$/);
      expect(focus.wide).toMatch(/^\d{1,3}% \d{1,3}%$/);
      expect(focus.narrow).toMatch(/^\d{1,3}% \d{1,3}%$/);
    }
  });

  it("leaves out the places the owner removed (B-03, B-04)", () => {
    const qids = HOME_BANNER_POOL.map(({ qid }) => qid);

    expect(qids).not.toContain("Q9386514");
    expect(qids).not.toContain("Q642455");
    expect(qids).not.toContain("Q9386686");
  });
});
