// The theme of the interface as remembered on the account (E9-4). The list is
// frozen in the CHECK of `account_settings.theme`; a test compares them.
export const THEMES = ["dark", "light"] as const;

export type Theme = (typeof THEMES)[number];

/** The night theme: the start of a guest and of an account that never chose (D-22). */
export const DEFAULT_THEME: Theme = "dark";

/** A known theme, or `null` for anything else (a wrong value is refused, never guessed). */
export function parseTheme(value: unknown): Theme | null {
  return value === "dark" || value === "light" ? value : null;
}
