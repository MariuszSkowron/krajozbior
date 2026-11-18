export const SIGN_IN_CODE_VALIDITY_MINUTES = 10;

/** Name of the application in messages; `npm run rename-project` replaces it. */
export const APP_NAME = "Krajozbiór";

export type SignInCodeEmailInput = Readonly<{
  code: string;
  /** Public address of the site (footer link). */
  siteUrl: string;
}>;

export type RenderedEmail = Readonly<{ subject: string; text: string; html: string }>;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The only data in the message is the code and the site link; no images, no
// tracking, no account details.
export function renderSignInCodeEmail(input: SignInCodeEmailInput): RenderedEmail {
  const { code, siteUrl } = input;
  const subject = `${code.replace(/[\r\n]+/g, " ")} — kod logowania (${APP_NAME})`;
  const rest = `Kod jest ważny ${SIGN_IN_CODE_VALIDITY_MINUTES} minut. Jeśli to nie Ty prosisz o kod, zignoruj tę wiadomość — bez kodu nikt nie zaloguje się na Twoje konto.`;

  const text = [
    `Twój kod logowania (${APP_NAME}): ${code}.`,
    "",
    rest,
    "",
    "--",
    APP_NAME,
    siteUrl,
    "",
  ].join("\n");

  const html = `<!doctype html>
<html lang="pl">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: sans-serif; line-height: 1.5;">
<p>Twój kod logowania (${escapeHtml(APP_NAME)}):</p>
<p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${escapeHtml(code)}</p>
<p>${escapeHtml(rest)}</p>
<hr>
<p style="font-size: 13px;">${escapeHtml(APP_NAME)}<br>
<a href="${escapeHtml(siteUrl)}">${escapeHtml(siteUrl)}</a></p>
</body>
</html>
`;

  return { subject, text, html };
}
