import { describe, expect, it } from "vitest";

import {
  CONTACT_EMAIL,
  LEGAL_PAGES,
  isLegalPath,
  legalPage,
} from "@/features/legal/domain/legal-pages";

describe("the legal pages", () => {
  it("are four public routes with distinct addresses", () => {
    expect(LEGAL_PAGES.map((page) => page.path)).toEqual([
      "/regulamin",
      "/polityka-prywatnosci",
      "/zasady",
      "/oswiadczenie-o-zdjeciach",
    ]);
    expect(new Set(LEGAL_PAGES.map((page) => page.slug)).size).toBe(4);
  });

  it("find a page by its slug", () => {
    expect(legalPage("zasady")).toEqual({
      slug: "zasady",
      path: "/zasady",
      title: "Najważniejsze zasady",
    });
  });

  it("name the contact address of the decision D-36", () => {
    expect(CONTACT_EMAIL).toBe("kontakt@mariuszskowron.pl");
  });
});

describe("isLegalPath", () => {
  it.each([
    "/regulamin",
    "/regulamin/",
    "/regulamin?x=1",
    "/regulamin#rozdzial-1",
    "/polityka-prywatnosci",
    "/zasady",
    "/oswiadczenie-o-zdjeciach?a=b",
  ])("recognises %s", (url) => {
    expect(isLegalPath(url)).toBe(true);
  });

  it.each([
    "/",
    "/my",
    "/regulamin-2",
    "/regulamin/x",
    "/Regulamin",
    "/my/regulamin",
    "/?next=/regulamin",
    "",
  ])("does not recognise %j", (url) => {
    expect(isLegalPath(url)).toBe(false);
  });
});
