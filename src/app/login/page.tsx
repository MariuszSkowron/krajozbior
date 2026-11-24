import type { Metadata } from "next";

import { getRequestActor } from "@/app/request-actor";

import { LoginScreen } from "./login-screen";

export const dynamic = "force-dynamic";

// The title names the view a signed-in user actually sees (WCAG 2.4.2).
// The login screen is kept out of search results (E11-Q15 A).
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getRequestActor()) === null ? "Zaloguj się — Krajozbiór" : "Konto — Krajozbiór",
    robots: { index: false, follow: true },
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// "Zaloguj się": the entrance for people who have an account. The mechanism is shared with
// "Załóż konto" (zaloz-konto/page.tsx); see login-screen.tsx.
export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return <LoginScreen entry="login" searchParams={searchParams} />;
}
