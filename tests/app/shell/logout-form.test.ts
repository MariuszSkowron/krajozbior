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
  });
});
