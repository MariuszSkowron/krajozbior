import { describe, expect, it } from "vitest";

import {
  MAX_NEWS_PER_ORGANIZATION,
  MAX_NEWS_PUBLISHED_PER_DAY,
  NEWS_PUBLISH_ACTION,
  newsPublishLimit,
} from "@/features/news/domain/limits";
import {
  NEWS_KINDS,
  NEWS_KIND_LABELS,
  NEWS_STATUSES,
  NEWS_STATUS_LABELS,
  canCuratorTransition,
  canOperatorTransition,
  isNewsEditable,
  isNewsKind,
  isNewsPublic,
  isNewsStatus,
  newsDeletion,
  showUpdatedNote,
  type NewsStatus,
} from "@/features/news/domain/news";
import { assertValidLimit } from "@/features/identity/domain/action-rate-limit";

const DAY = 24 * 60 * 60 * 1000;

describe("kinds, states and labels", () => {
  it("has a Polish label for every kind and state", () => {
    expect(NEWS_KINDS.map((kind) => NEWS_KIND_LABELS[kind])).toEqual([
      "Nowe miejsce",
      "Zmiana informacji",
      "Wydarzenie",
      "Poradnik",
      "Społeczność",
    ]);
    expect(NEWS_STATUSES.map((status) => NEWS_STATUS_LABELS[status])).toEqual([
      "Szkic",
      "Opublikowana",
      "Wycofana",
      "Ukryta przez zespół",
    ]);
  });

  it("recognizes only known kinds and states", () => {
    expect(isNewsKind("event")).toBe(true);
    expect(isNewsKind("Event")).toBe(false);
    expect(isNewsKind(3)).toBe(false);
    expect(isNewsStatus("hidden")).toBe(true);
    expect(isNewsStatus("deleted")).toBe(false);
    expect(isNewsStatus(null)).toBe(false);
  });
});

describe("transitions", () => {
  const all = NEWS_STATUSES;

  it("lets a curator publish, edit, withdraw and publish again, nothing else", () => {
    const allowed = new Set([
      "draft>published",
      "published>published",
      "published>withdrawn",
      "withdrawn>published",
    ]);

    for (const from of all) {
      for (const to of all) {
        expect(canCuratorTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it("lets only the operator hide and restore", () => {
    const allowed = new Set(["published>hidden", "withdrawn>hidden", "hidden>withdrawn"]);

    for (const from of all) {
      for (const to of all) {
        expect(canOperatorTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it("never lets a curator into or out of the hidden state", () => {
    for (const status of all) {
      expect(canCuratorTransition(status, "hidden")).toBe(false);
      expect(canCuratorTransition("hidden", status)).toBe(false);
    }
  });

  it("makes only a published item public and a hidden one not editable", () => {
    const states: [NewsStatus, boolean, boolean][] = [
      ["draft", false, true],
      ["published", true, true],
      ["withdrawn", false, true],
      ["hidden", false, false],
    ];

    for (const [status, isPublic, editable] of states) {
      expect(isNewsPublic(status)).toBe(isPublic);
      expect(isNewsEditable(status)).toBe(editable);
    }
  });
});

describe("newsDeletion (Q13)", () => {
  const now = new Date("2027-03-15T12:00:00Z");

  it("lets a draft go at once", () => {
    expect(newsDeletion("draft", null, now)).toEqual({ deletable: true });
  });

  it("never deletes a published or hidden item", () => {
    expect(newsDeletion("published", null, now)).toEqual({ deletable: false, reason: "status" });
    expect(newsDeletion("hidden", new Date(0), now)).toEqual({
      deletable: false,
      reason: "status",
    });
  });

  it("does not delete a withdrawn item without a withdrawal time", () => {
    expect(newsDeletion("withdrawn", null, now)).toEqual({ deletable: false, reason: "status" });
  });

  it("deletes a withdrawn item 14 days after the withdrawal, not a moment earlier", () => {
    const withdrawnAt = new Date(now.getTime() - 14 * DAY);

    expect(newsDeletion("withdrawn", withdrawnAt, now)).toEqual({ deletable: true });
    expect(newsDeletion("withdrawn", new Date(withdrawnAt.getTime() + 1), now)).toEqual({
      deletable: false,
      reason: "too_early",
      deletableFrom: new Date(withdrawnAt.getTime() + 1 + 14 * DAY),
    });
    expect(newsDeletion("withdrawn", new Date(now.getTime() - 20 * DAY), now)).toEqual({
      deletable: true,
    });
  });
});

describe("showUpdatedNote (D-E7-9)", () => {
  const published = new Date("2027-03-15T12:00:00Z");

  it("shows only when the content changed more than 10 minutes after publishing", () => {
    expect(showUpdatedNote(published, new Date(published.getTime() + 10 * 60 * 1000))).toBe(false);
    expect(showUpdatedNote(published, new Date(published.getTime() + 10 * 60 * 1000 + 1))).toBe(
      true,
    );
    expect(showUpdatedNote(published, new Date(published.getTime() - 1000))).toBe(false);
  });

  it("shows nothing when either time is missing", () => {
    expect(showUpdatedNote(null, published)).toBe(false);
    expect(showUpdatedNote(published, null)).toBe(false);
    expect(showUpdatedNote(null, null)).toBe(false);
  });
});

describe("publication limits (D-E7-7)", () => {
  it("keeps the frozen values and a window the action limiter accepts", () => {
    expect(MAX_NEWS_PUBLISHED_PER_DAY).toBe(20);
    expect(MAX_NEWS_PER_ORGANIZATION).toBe(200);
    expect(NEWS_PUBLISH_ACTION).toBe("news_publish");
    expect(newsPublishLimit).toEqual({ limit: 10, windowSeconds: 900 });
    expect(() => assertValidLimit(newsPublishLimit)).not.toThrow();
  });
});
