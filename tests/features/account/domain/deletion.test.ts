import { describe, expect, it } from "vitest";

import {
  DELETE_CONFIRMATION_WORD,
  FRESH_SIGN_IN_MS,
  isDeletionConfirmed,
  isSignInFresh,
} from "@/features/account/domain/deletion";
import { parseDeletionRequest } from "@/features/account/domain/deletion-request";

describe("isDeletionConfirmed", () => {
  it("accepts the word, with spaces and in any letter case", () => {
    for (const text of [DELETE_CONFIRMATION_WORD, "usuń", "  Usuń ", "USUŃ\n"]) {
      expect(isDeletionConfirmed(text), text).toBe(true);
    }
  });

  it("accepts the word typed with a combining accent", () => {
    expect(isDeletionConfirmed("USUŃ")).toBe(true);
  });

  it("refuses anything else, also a value that is not text", () => {
    for (const value of ["", "USUN", "usuń konto", "DELETE", undefined, null, 5, { a: 1 }]) {
      expect(isDeletionConfirmed(value), String(value)).toBe(false);
    }
  });
});

describe("isSignInFresh", () => {
  const now = new Date("2026-11-18T12:00:00Z");

  it("is fresh for a session created less than 15 minutes ago", () => {
    expect(isSignInFresh(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(isSignInFresh(new Date(now.getTime() - FRESH_SIGN_IN_MS + 1), now)).toBe(true);
  });

  it("is not fresh from exactly 15 minutes on", () => {
    expect(isSignInFresh(new Date(now.getTime() - FRESH_SIGN_IN_MS), now)).toBe(false);
    expect(isSignInFresh(new Date(now.getTime() - 24 * 60 * 60 * 1000), now)).toBe(false);
  });

  it("is not fresh without a session start", () => {
    expect(isSignInFresh(null, now)).toBe(false);
  });
});

describe("parseDeletionRequest", () => {
  it("reads the confirmation word", () => {
    expect(parseDeletionRequest({ confirmation: "USUŃ" })).toEqual({ confirmation: "USUŃ" });
  });

  it("refuses a body with an account id or any other field", () => {
    expect(parseDeletionRequest({ confirmation: "USUŃ", userId: "x" })).toBeNull();
    expect(parseDeletionRequest({ confirmation: "USUŃ", id: "x" })).toBeNull();
  });

  it("refuses a missing, non-text or oversized confirmation and a body that is not an object", () => {
    for (const body of [
      {},
      { confirmation: 1 },
      { confirmation: "x".repeat(101) },
      null,
      "USUŃ",
      [],
    ]) {
      expect(parseDeletionRequest(body), JSON.stringify(body)).toBeNull();
    }
  });
});
