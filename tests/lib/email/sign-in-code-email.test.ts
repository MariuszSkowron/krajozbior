import { describe, expect, it } from "vitest";

import { APP_NAME, escapeHtml, renderSignInCodeEmail } from "@/lib/email/sign-in-code-email";

const input = { code: "123456", siteUrl: "https://starter.example" };

describe("renderSignInCodeEmail", () => {
  const email = renderSignInCodeEmail(input);

  it("puts the code in the subject and both bodies, in Polish", () => {
    expect(email.subject).toBe(`123456 — kod logowania (${APP_NAME})`);
    expect(email.text).toContain(`Twój kod logowania (${APP_NAME}): 123456.`);
    expect(email.text).toContain("Kod jest ważny 10 minut.");
    expect(email.html).toContain("123456");
    expect(email.html).toContain('lang="pl"');
  });

  it("has no remote images, scripts or other external resources", () => {
    expect(email.html).not.toMatch(/<img|<script|<link|<iframe|<video|<audio|<object|<embed/i);
    expect(email.html).not.toMatch(/\bsrc\s*=|url\(|@import/i);
  });

  it("links only to the site", () => {
    const urls = [...(email.html + email.text).matchAll(/https?:\/\/[^\s"'<)]+/g)].map(
      (match) => match[0],
    );

    expect(new Set(urls)).toEqual(new Set([input.siteUrl]));
  });

  it("carries no data besides the code and the site link", () => {
    const withoutKnown = (value: string) =>
      value.replaceAll(input.code, "").replaceAll(input.siteUrl, "");

    // The template takes no recipient, so no address or name can leak in.
    expect(withoutKnown(email.text + email.html)).not.toMatch(/@|\d{4,}/);
  });

  it("escapes HTML in the code and the link, but not in the plain text", () => {
    const hostile = renderSignInCodeEmail({
      code: `<b>"&'`,
      siteUrl: `https://starter.example/"><script>?a=1&b=2`,
    });

    expect(hostile.html).not.toContain("<b>");
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).toContain("&lt;b&gt;&quot;&amp;&#39;");
    expect(hostile.html).toContain("a=1&amp;b=2");
    expect(hostile.text).toContain(`<b>"&'`);
  });

  it("keeps line breaks out of the subject", () => {
    expect(renderSignInCodeEmail({ ...input, code: "12\r\nBcc: x" }).subject).not.toMatch(/[\r\n]/);
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
