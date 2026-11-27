import { CONTACT_ADDRESSES } from "@/features/legal/domain/legal-pages";

export const SIGN_IN_CODE_VALIDITY_MINUTES = 10;

/** Name of the application in messages; `npm run rename-project` replaces it. */
export const APP_NAME = "Krajozbiór";

export type SignInCodeEmailInput = Readonly<{
  code: string;
  /** Public address of the site (footer, as plain text). */
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

/** Footer line required by the privacy policy (D-36 pkt 1, E11 5.8). */
export const DATA_CONTROLLER_LINE = `Administrator danych: Mariusz Skowron, ${CONTACT_ADDRESSES.privacy}`;

export const PRIVACY_POLICY_PATH = "/polityka-prywatnosci";

// The only data in the message is the code, the site address and the fixed
// footer; no images, no tracking, no account details. The footer addresses are
// plain text, not links (<a>), so nothing in the message can be rewritten into
// a tracking redirect by the provider.
export function renderSignInCodeEmail(input: SignInCodeEmailInput): RenderedEmail {
  const { code, siteUrl } = input;
  const subject = `${code.replace(/[\r\n]+/g, " ")} — kod logowania (${APP_NAME})`;
  const rest = `Kod jest ważny ${SIGN_IN_CODE_VALIDITY_MINUTES} minut. To nie Ty prosisz o kod? Zignoruj tę wiadomość — bez kodu nikt nie zaloguje się na Twoje konto.`;
  const privacy = `Polityka prywatności: ${siteUrl.replace(/\/+$/, "")}${PRIVACY_POLICY_PATH}`;

  const text = [
    `Twój kod logowania (${APP_NAME}): ${code}.`,
    "",
    rest,
    "",
    "--",
    APP_NAME,
    siteUrl,
    DATA_CONTROLLER_LINE,
    privacy,
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
${escapeHtml(siteUrl)}<br>
${escapeHtml(DATA_CONTROLLER_LINE)}<br>
${escapeHtml(privacy)}</p>
</body>
</html>
`;

  return { subject, text, html };
}
