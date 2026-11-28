import "server-only";

import { loginEmailClearCookieHeader } from "@/app/login/login-email-cookie";
import { isSameOrigin } from "@/features/identity/domain/origin";
import { safeReturnTo } from "@/features/identity/domain/return-to";
import {
  deleteNeverAcceptedAccount,
  getIdentityProvider,
} from "@/features/identity/infrastructure";
import { clearedProfileDraftCookie } from "@/features/profile/domain/profile-draft";
import {
  privateJson as json,
  readBoundedText,
  readJsonBody,
} from "@/features/visits/http/request-body";
import { logFailure } from "@/lib/log-failure";

import { declineTerms, type DeclineTermsDeps } from "../application/decline-terms";
import { acceptCurrentTerms } from "../application/terms";
import type { TermsDeps } from "../application/terms-types";
import { getTermsDeps } from "../infrastructure/terms-deps";

// POST /api/me/terms-acceptance: akceptacja bieżącej wersji regulaminu. Natywny formularz
// ekranu „Zanim zaczniesz” (urlencoded) dostaje przekierowanie, żądanie JSON dostaje status.
// Kontrola pochodzenia, aktor z sesji, ograniczone ciało i odwzorowanie odpowiedzi przypadku
// użycia na status. Ciało nie wskazuje właściciela ani wersji.

const BODY_MAX_BYTES = 1024;

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { "Cache-Control": "private, no-store", Location: location },
  });
}

async function readBody(
  request: Request,
  isForm: boolean,
): Promise<{ tooLarge: true } | { body: Record<string, unknown> }> {
  if (isForm) {
    const read = await readBoundedText(request, BODY_MAX_BYTES);

    return "tooLarge" in read
      ? read
      : { body: Object.fromEntries(new URLSearchParams(read.text).entries()) };
  }

  const read = await readJsonBody(request, BODY_MAX_BYTES);

  if ("tooLarge" in read) {
    return read;
  }

  const body = read.body;

  return {
    body: typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {},
  };
}

// POST /api/me/terms-decline: „Nie akceptuję” na ekranie „Zanim zaczniesz”. Konto, które nigdy
// niczego nie zaakceptowało, jest usuwane od razu (decline-terms.ts); w każdym przypadku sesja
// się kończy. Najpierw wylogowanie (daje ciasteczka do wyczyszczenia), potem usunięcie, bo
// usunięcie konta kasuje też jego sesję. Ciało żądania jest ignorowane: nic w nim nie wskazuje
// konta. Odpowiedź to przekierowanie na stronę główną z sygnałem w adresie.
export async function handleTermsDecline(
  request: Request,
  deps: DeclineTermsDeps = { deleteNeverAcceptedAccount },
): Promise<Response> {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { error: "forbidden_origin" });
  }

  let actor: Awaited<ReturnType<ReturnType<typeof getIdentityProvider>["getActor"]>>;
  let cookies: string[];

  try {
    const provider = getIdentityProvider();

    actor = await provider.getActor(request.headers);

    if (actor === null) {
      return redirect("/login");
    }

    cookies = await provider.signOut(request.headers);
  } catch (error) {
    logFailure("Terms decline sign-out", error);

    return redirect("/?wylogowanie=blad");
  }

  let signal = "odmowa";

  try {
    signal = (await declineTerms(actor, deps)) === "deleted" ? "odmowa" : "odmowa-konto";
  } catch (error) {
    logFailure("Terms decline account deletion", error);
    signal = "odmowa-blad";
  }

  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Location: `/?wylogowano=${signal}`,
  });

  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  headers.append("Set-Cookie", clearedProfileDraftCookie());
  headers.append("Set-Cookie", loginEmailClearCookieHeader());

  return new Response(null, { status: 303, headers });
}

export async function handleTermsAcceptance(
  request: Request,
  deps: TermsDeps = getTermsDeps(),
): Promise<Response> {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { error: "forbidden_origin" });
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isForm =
    contentType.startsWith("application/x-www-form-urlencoded") ||
    contentType.startsWith("multipart/form-data");

  try {
    const actor = await getIdentityProvider().getActor(request.headers);

    // Gość odpada, zanim ciało zostanie odczytane.
    if (actor === null) {
      return isForm ? redirect("/login") : json(401, { error: "unauthenticated" });
    }

    const read = await readBody(request, isForm);

    if ("tooLarge" in read) {
      return isForm ? redirect("/?zgoda=wymagana") : json(413, { error: "payload_too_large" });
    }

    const outcome = await acceptCurrentTerms(actor, read.body.accepted, deps);

    switch (outcome.status) {
      case "ok":
        return isForm ? redirect(safeReturnTo(read.body.returnTo)) : json(200, { accepted: true });
      case "unauthenticated":
        return isForm ? redirect("/login") : json(401, { error: "unauthenticated" });
      case "invalid":
        return isForm ? redirect("/?zgoda=wymagana") : json(400, { error: "invalid" });
    }
  } catch (error) {
    logFailure("Terms acceptance", error);

    return isForm ? redirect("/?zgoda=niedostepny") : json(503, { error: "unavailable" });
  }
}
