import { describe, expect, it } from "vitest";

import {
  entryPath,
  FIRST_SIGN_IN_FROM_LOGIN,
  FIRST_SIGN_IN_PARAM,
  loginEntry,
  withFirstSignInNotice,
} from "@/features/identity/domain/login-entry";

describe("loginEntry", () => {
  it("selects the signup entrance only for the exact value", () => {
    expect(loginEntry("signup")).toBe("signup");
    expect(loginEntry("login")).toBe("login");
    expect(loginEntry("Signup")).toBe("login");
    expect(loginEntry(undefined)).toBe("login");
    expect(loginEntry(["signup"])).toBe("login");
  });
});

describe("entryPath", () => {
  it("has a page for each entrance, under /login", () => {
    expect(entryPath("login")).toBe("/login");
    expect(entryPath("signup")).toBe("/login/zaloz-konto");
  });

  it("carries the destination as an encoded returnTo", () => {
    expect(entryPath("login", "/places/1?a=b")).toBe("/login?returnTo=%2Fplaces%2F1%3Fa%3Db");
    expect(entryPath("signup", "/my")).toBe("/login/zaloz-konto?returnTo=%2Fmy");
  });
});

describe("withFirstSignInNotice", () => {
  it("adds the mark to a plain path and keeps the path", () => {
    expect(withFirstSignInNotice("/")).toBe(`/?${FIRST_SIGN_IN_PARAM}=${FIRST_SIGN_IN_FROM_LOGIN}`);
  });

  it("keeps an existing query and a fragment", () => {
    expect(withFirstSignInNotice("/places/1?a=b#c")).toBe(
      `/places/1?a=b&${FIRST_SIGN_IN_PARAM}=${FIRST_SIGN_IN_FROM_LOGIN}#c`,
    );
  });
});
