"use server";

import { cookies, headers } from "next/headers";

import { getIdentityProvider } from "@/features/identity/infrastructure";
import { saveMyTheme } from "@/features/settings/application/settings";
import { getSettingsDeps } from "@/features/settings/infrastructure/settings-deps";
import { logFailure } from "@/lib/log-failure";

import { THEME_COOKIE, THEME_COOKIE_MAX_AGE_SECONDS, themeFromCookie } from "./theme";

/**
 * Zapisuje wybór motywu w ciasteczku wyglądu (nie jest daną osobową). Gdy osoba jest zalogowana,
 * zapisuje go też na jej koncie (E9-4), żeby wrócił po zalogowaniu na innym urządzeniu; gość
 * dostaje tylko ciasteczko. Niepowodzenie zapisu na koncie nie cofa ciasteczka: przełącznik
 * działa dalej, a błąd trafia do dziennika. Nie przekierowuje: Next.js renderuje bieżącą stronę
 * z nową klasą. Ochronę przed wywołaniem z obcej strony daje sprawdzanie nagłówka Origin w
 * akcjach serwera; właściciel wiersza to zawsze osoba z sesji, nigdy pole formularza.
 */
export async function setTheme(formData: FormData): Promise<void> {
  const theme = themeFromCookie(formData.get("theme")?.toString());

  (await cookies()).set(THEME_COOKIE, theme, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
  });

  try {
    const actor = await getIdentityProvider().getActor(await headers());

    // A guest: the use case answers `unauthenticated` and nothing is stored.
    await saveMyTheme(actor, theme, getSettingsDeps());
  } catch (error) {
    logFailure("Theme save", error);
  }
}
