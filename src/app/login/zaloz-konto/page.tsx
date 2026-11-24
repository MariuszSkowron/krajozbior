import type { Metadata } from "next";

import { getRequestActor } from "@/app/request-actor";

import { LoginScreen } from "../login-screen";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getRequestActor()) === null ? "Załóż konto — Krajozbiór" : "Konto — Krajozbiór",
    robots: { index: false, follow: true },
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// "Załóż konto": the same e-mail code mechanism as "Zaloguj się", with its own headings and
// texts. It lives under /login so the address cookie of the two steps reaches it
// (login-email-cookie.ts).
export default function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  return <LoginScreen entry="signup" searchParams={searchParams} />;
}
