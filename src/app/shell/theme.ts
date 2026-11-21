import { cookies } from "next/headers";

export const THEME_COOKIE = "krajozbior-theme";

export type Theme = "dark" | "light";

/** Wartość z ciasteczka motywu; każda inna (także brak) oznacza motyw nocny (D-22, Q2). */
export function themeFromCookie(value: string | undefined): Theme {
  return value === "light" ? "light" : "dark";
}

export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The same cookie as `setTheme` sets, as a `Set-Cookie` header value: the sign-in routes use
 * it to bring the theme saved on the account (E9-4). Not a personal datum, so no secret in it.
 */
export function themeSetCookieHeader(theme: Theme): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `${THEME_COOKIE}=${theme}; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

/** Motyw bieżącego żądania. Układ, `generateViewport()` i akcja przełącznika czytają go tą samą funkcją. */
export async function requestTheme(): Promise<Theme> {
  return themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
}

/**
 * Kolor paska przeglądarki: tło `--color-surface-canvas` aktywnego motywu. Jedyny literał koloru
 * poza `tokens.css`; test jednostkowy porównuje go z tokenami.
 */
export const themeColor: Record<Theme, string> = {
  dark: "#0B0D12",
  light: "#F4F2EC",
};
