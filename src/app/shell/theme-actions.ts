"use server";

import { cookies } from "next/headers";

import { THEME_COOKIE, themeFromCookie } from "./theme";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Zapisuje wybór motywu w ciasteczku wyglądu (nie jest daną osobową; bez dostępu do bazy,
 * bez logowania). Nie przekierowuje: Next.js renderuje bieżącą stronę z nową klasą.
 * Ochronę przed wywołaniem z obcej strony daje sprawdzanie nagłówka Origin w akcjach serwera.
 */
export async function setTheme(formData: FormData): Promise<void> {
  const theme = themeFromCookie(formData.get("theme")?.toString());

  (await cookies()).set(THEME_COOKIE, theme, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}
