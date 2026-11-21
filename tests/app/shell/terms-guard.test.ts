import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/", search: "" }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

const { TermsGuard } = await import("@/app/shell/terms-guard");

const render = () =>
  renderToStaticMarkup(createElement(TermsGuard, null, createElement("p", null, "Treść strony")));

beforeEach(() => {
  mocks.pathname = "/";
  mocks.search = "";
});

// The guard renders again on every client navigation (unlike the layout), so each address
// it is given is a separate decision: the screen everywhere except the four legal pages.
describe("the terms guard of an account without the acceptance (F-K3)", () => {
  it.each(["/regulamin", "/polityka-prywatnosci", "/zasady/", "/oswiadczenie-o-zdjeciach"])(
    "lets the legal page %s through",
    (pathname) => {
      mocks.pathname = pathname;

      expect(render()).toBe("<p>Treść strony</p>");
    },
  );

  it.each(["/", "/my", "/collections/x", "/Regulamin", "/regulamin-x", "/regulamin/x"])(
    "shows the screen instead of %s",
    (pathname) => {
      mocks.pathname = pathname;

      const html = render();

      expect(html).toContain("<h1>Zanim zaczniesz</h1>");
      expect(html).not.toContain("Treść strony");
      expect(html).toContain(`name="returnTo" value="${pathname}"`);
    },
  );

  it("follows a client navigation from a legal page to the start page", () => {
    mocks.pathname = "/regulamin";
    expect(render()).toContain("Treść strony");

    mocks.pathname = "/";
    expect(render()).toContain("<h1>Zanim zaczniesz</h1>");
  });

  it("shows the message for a known `zgoda` code only", () => {
    mocks.search = "zgoda=niedostepny";
    expect(render()).toContain("Nie udało się zapisać akceptacji");

    mocks.search = "zgoda=constructor";
    expect(render()).not.toContain('role="alert"');
  });
});
