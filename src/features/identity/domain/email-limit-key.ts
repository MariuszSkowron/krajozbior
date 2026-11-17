// The key the sign-in code limits count an address under. Not the account
// address: an account is created and signed in with the address as typed
// (trimmed, lower case). Aliases that reach the same mailbox share one key, so
// `jan+1@gmail.com` and `j.an@gmail.com` cannot get around the per-address
// limit:
// - lower case, surrounding whitespace removed;
// - a `+tag` suffix of the local part removed for every domain;
// - for gmail.com and googlemail.com: dots of the local part removed and the
//   domain written as gmail.com.
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function emailLimitKey(email: string): string {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");

  if (at <= 0) {
    return address;
  }

  let local = address.slice(0, at);
  let domain = address.slice(at + 1);
  const plus = local.indexOf("+");

  // A local part that starts with "+" keeps its text: an empty key would join
  // unrelated addresses of the domain.
  if (plus > 0) {
    local = local.slice(0, plus);
  }

  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "") || local;
    domain = "gmail.com";
  }

  return `${local}@${domain}`;
}
