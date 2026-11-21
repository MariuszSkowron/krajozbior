import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LogoutForm } from "@/app/shell/logout-form";

// #66 review: every logout button is a native form post (works without
// JavaScript); with JavaScript it also clears the tab's private visit drafts.
describe("LogoutForm", () => {
  it("is a native POST form with the button text and class", () => {
    const html = renderToStaticMarkup(LogoutForm({ className: "btn", children: "Wyloguj" }));

    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/auth/logout"');
    expect(html).toMatch(/<button[^>]*class="btn"[^>]*type="submit">Wyloguj<\/button>/);
    expect(html).not.toContain("returnTo");
  });

  it("carries a return path when the deletion screen asks for a fresh sign-in", () => {
    const html = renderToStaticMarkup(
      LogoutForm({
        className: "btn",
        children: "Zaloguj się ponownie",
        returnTo: "/my/delete-account",
      }),
    );

    expect(html).toContain('<input type="hidden" name="returnTo" value="/my/delete-account"/>');
  });

  it("names the reason when the terms are declined (F-K3)", () => {
    const html = renderToStaticMarkup(
      LogoutForm({ className: "btn", children: "Nie akceptuję", reason: "terms-declined" }),
    );

    expect(html).toContain('<input type="hidden" name="reason" value="terms-declined"/>');
    expect(html).not.toContain("returnTo");
  });
});
