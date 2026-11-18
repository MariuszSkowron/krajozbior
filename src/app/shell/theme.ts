import { cookies } from "next/headers";

export const THEME_COOKIE = "krajozbior-theme";

export type Theme = "dark" | "light";

/** Wartość z ciasteczka motywu; każda inna (także brak) oznacza motyw nocny (D-22, Q2). */
export function themeFromCookie(value: string | undefined): Theme {
  return value === "light" ? "light" : "dark";
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
