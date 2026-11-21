import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TermsGate, termsGateProblem } from "@/app/shell/terms-gate";

const html = (url: string) => {
  const [path = "/", query = ""] = url.split("?");

  return renderToStaticMarkup(
    createElement(TermsGate, { path, problemCode: new URLSearchParams(query).get("zgoda") }),
  );
};

describe("the screen „Zanim zaczniesz” (E11-Q4 A)", () => {
  it("has the heading, a summary and links to the full texts that open as new pages", () => {
    const markup = html("/my");

    expect(markup).toContain("<h1>Zanim zaczniesz</h1>");
    expect(markup).toContain("<ul");
    for (const [href, label] of [
      ["/regulamin", "Regulamin"],
      ["/polityka-prywatnosci", "Polityka prywatności"],
      ["/zasady", "Najważniejsze zasady"],
    ]) {
      expect(markup).toContain(`<a href="${href}">${label}</a>`);
    }
  });

  it("asks for the acceptance of the draft terms with a required checkbox, in a native form", () => {
    const markup = html("/my");

    expect(markup).toMatch(
      /<form [^>]*action="\/api\/me\/terms-acceptance" method="post">.*<input type="checkbox" required="" name="accepted"\/>/,
    );
    expect(markup).toContain(
      "Akceptuję Regulamin (wersja robocza z dnia 19 listopada 2026 r.) i zapoznałem się / zapoznałam się z Polityką prywatności.",
    );
    expect(markup).toContain(">Akceptuję</button>");
  });

  it("comes back to the page it replaced, never to a foreign address", () => {
    expect(html("/my/collections?a=1")).toContain('name="returnTo" value="/my/collections"');
    expect(html("//evil.example/x")).toContain('name="returnTo" value="/"');
  });

  it("offers „Nie akceptuję — wyloguj” as a logout that names the reason", () => {
    const markup = html("/my");

    expect(markup).toMatch(
      /<form action="\/api\/auth\/logout" method="post"><input type="hidden" name="reason" value="terms-declined"\/><button [^>]*type="submit">Nie akceptuję — wyloguj<\/button><\/form>/,
    );
  });

  it("is kept out of search results (E11-Q15 A)", () => {
    expect(html("/")).toContain('<meta name="robots" content="noindex"/>');
  });

  it("shows no error at first and a clear one after a refused post", () => {
    expect(html("/")).not.toContain('role="alert"');
    expect(html("/?zgoda=wymagana")).toContain('role="alert"');
    expect(html("/?zgoda=wymagana")).toContain("Zaznacz pole „Akceptuję Regulamin”");
    expect(html("/?zgoda=niedostepny")).toContain("Nie udało się zapisać akceptacji");
  });

  it("maps only known problem codes to a message", () => {
    expect(termsGateProblem("wymagana")).toBeDefined();
    expect(termsGateProblem("niedostepny")).toBeDefined();
    expect(termsGateProblem("constructor")).toBeUndefined();
    expect(termsGateProblem("x")).toBeUndefined();
    expect(termsGateProblem(null)).toBeUndefined();
  });
});
