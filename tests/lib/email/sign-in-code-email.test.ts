import { describe, expect, it } from "vitest";

import {
  APP_NAME,
  DATA_CONTROLLER_LINE,
  escapeHtml,
  PRIVACY_POLICY_PATH,
  renderSignInCodeEmail,
} from "@/lib/email/sign-in-code-email";

const input = { code: "123456", siteUrl: "https://krajozbior.example" };

describe("renderSignInCodeEmail", () => {
  const email = renderSignInCodeEmail(input);

  it("puts the code in the subject and both bodies, in Polish", () => {
    expect(email.subject).toBe(`123456 — kod logowania (${APP_NAME})`);
    expect(email.text).toContain(`Twój kod logowania (${APP_NAME}): 123456.`);
    expect(email.text).toContain("Kod jest ważny 10 minut.");
    expect(email.text).toContain(
      "To nie Ty prosisz o kod? Zignoruj tę wiadomość — bez kodu nikt nie zaloguje się na Twoje konto.",
    );
    expect(email.html).toContain("123456");
    expect(email.html).toContain('lang="pl"');
  });

  it("warns in both bodies not to give the code to anyone (D-08)", () => {
    const warning = `Wpisz go tylko na stronie ${APP_NAME} i nie podawaj nikomu — nie poprosimy o niego e-mailem, telefonem ani wiadomością.`;

    expect(email.text).toContain(warning);
    expect(email.html).toContain(warning);
  });

  it("has no remote images, scripts or other external resources", () => {
    expect(email.html).not.toMatch(/<img|<script|<link|<iframe|<video|<audio|<object|<embed/i);
    expect(email.html).not.toMatch(/\bsrc\s*=|url\(|@import/i);
  });

  it("names only the site and its privacy policy, as plain text without links", () => {
    const urls = [...(email.html + email.text).matchAll(/https?:\/\/[^\s"'<)]+/g)].map(
      (match) => match[0],
    );

    expect(new Set(urls)).toEqual(
      new Set([input.siteUrl, `${input.siteUrl}${PRIVACY_POLICY_PATH}`]),
    );
    expect(email.html).not.toMatch(/<a\b|href\s*=/i);
  });

  it("ends with the data controller and the privacy policy in both bodies (E11 5.8)", () => {
    const footer = [
      "Administrator danych: Mariusz Skowron, prywatnosc@krajozbior.pl",
      "Polityka prywatności: https://krajozbior.example/polityka-prywatnosci",
    ];

    expect(DATA_CONTROLLER_LINE).toBe(footer[0]);
    expect(email.text.trimEnd().split("\n").slice(-2)).toEqual(footer);
    for (const line of footer) expect(email.html).toContain(line);
    expect(
      renderSignInCodeEmail({ ...input, siteUrl: "https://krajozbior.example/" }).text,
    ).toContain(footer[1]);
  });

  it("carries no data besides the code, the site address and the fixed footer", () => {
    const withoutKnown = (value: string) =>
      value
        .replaceAll(input.code, "")
        .replaceAll(input.siteUrl, "")
        .replaceAll(DATA_CONTROLLER_LINE, "");

    // The template takes no recipient, so no address or name can leak in.
    expect(withoutKnown(email.text + email.html)).not.toMatch(/@|\d{4,}/);
  });

  it("escapes HTML in the code and the link, but not in the plain text", () => {
    const hostile = renderSignInCodeEmail({
      code: `<b>"&'`,
      siteUrl: `https://krajozbior.example/"><script>?a=1&b=2`,
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
