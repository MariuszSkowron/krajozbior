import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import AppError from "@/app/error";
import GlobalError from "@/app/global-error";

// QA-5: a failure of the database or the shell shows a Polish page, never the English
// default of Next.js, and says nothing about the cause.
describe("the global error pages", () => {
  const retry = vi.fn();
  const error = new Error("db down: secret-host");

  it("the segment boundary is Polish, offers a retry and reveals nothing", () => {
    const html = renderToStaticMarkup(createElement(AppError, { error, retry }));

    expect(html).toContain("<h1>Nie udało się wczytać strony</h1>");
    expect(html).toContain("Spróbuj ponownie");
    expect(html).not.toContain("secret-host");
    expect(html).not.toMatch(/Something went wrong|Try again/);
  });

  it("the document boundary is a Polish page of its own with a title and a retry", () => {
    const html = renderToStaticMarkup(createElement(GlobalError, { error, retry }));

    expect(html).toMatch(/^<html lang="pl" class="theme-dark">/);
    expect(html).toContain("<title>Nie udało się wczytać strony — Krajozbiór</title>");
    expect(html).toContain("<h1>Nie udało się wczytać strony</h1>");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Spróbuj ponownie");
    expect(html).not.toContain("secret-host");
  });
});
