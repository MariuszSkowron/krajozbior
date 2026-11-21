import "server-only";

import { isSameOrigin } from "@/features/identity/domain/origin";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { clearedProfileDraftCookie } from "@/features/profile/domain/profile-draft";
import { readBoundedForm, readJsonBody } from "@/features/visits/http/request-body";
import { logFailure } from "@/lib/log-failure";

import { deleteOwnAccount } from "../application/delete-own-account";
import type { DeleteAccountDeps, DeleteAccountOutcome } from "../application/delete-account-types";
import { parseDeletionRequest } from "../domain/deletion-request";
import { getDeleteAccountDeps } from "../infrastructure/delete-account-deps";

// POST /api/me/account/deletion: origin check, the actor from the session, the
// body (the confirmation word only), and the mapping of the use case answer to
// a status. A native form post (the screen works without JavaScript) gets a
// redirect instead of JSON. Rules live in the use case; nothing here decides who
// may delete what.

const PRIVATE = { "Cache-Control": "private, no-store" };
const DELETED_LOCATION = "/?konto=usuniete";
const SCREEN = "/my/delete-account";

type Failure = "managed_account" | "stale_session" | "invalid_confirmation" | "invalid_request";

const failureStatus: Record<Failure, number> = {
  managed_account: 409,
  stale_session: 409,
  invalid_confirmation: 422,
  invalid_request: 400,
};

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: PRIVATE });
}

function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers(PRIVATE);

  headers.set("Location", location);
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(null, { status: 303, headers });
}

// A form is sent back to the deletion screen, which explains the refusal.
function failure(code: Failure, isForm: boolean): Response {
  return isForm ? redirect(`${SCREEN}?blad=${code}`) : json(failureStatus[code], { error: code });
}

// The body holds the confirmation word only; anything near this size is not that.
const BODY_MAX_BYTES = 4 * 1024;

async function readBody(
  request: Request,
  isForm: boolean,
): Promise<{ tooLarge: true } | { body: unknown }> {
  if (isForm) {
    // A damaged form body is a bad request, not an outage.
    const read = await readBoundedForm(request, BODY_MAX_BYTES);

    if ("tooLarge" in read) {
      return read;
    }

    return { body: read.form === null ? null : Object.fromEntries(read.form.entries()) };
  }

  const read = await readJsonBody(request, BODY_MAX_BYTES);

  // `readJsonBody` answers `undefined` for a body that is not JSON: a bad request.
  return "tooLarge" in read ? read : { body: read.body ?? null };
}

export async function handleAccountDeletion(
  request: Request,
  deps: DeleteAccountDeps = getDeleteAccountDeps(),
): Promise<Response> {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { error: "forbidden_origin" });
  }

  const isForm = (request.headers.get("content-type") ?? "").includes("form");

  try {
    const provider = getIdentityProvider();
    const actor = await provider.getActor(request.headers);

    // A guest gets 401 whatever the body is.
    if (actor === null) {
      return json(401, { error: "unauthenticated" });
    }

    const read = await readBody(request, isForm);

    if ("tooLarge" in read) {
      return isForm
        ? redirect(`${SCREEN}?blad=invalid_request`)
        : json(413, { error: "payload_too_large" });
    }

    const body = parseDeletionRequest(read.body);

    if (body === null) {
      return failure("invalid_request", isForm);
    }

    const outcome: DeleteAccountOutcome = await deleteOwnAccount(
      actor,
      {
        confirmation: body.confirmation,
        sessionCreatedAt: await provider.getSessionCreatedAt(request.headers),
      },
      deps,
    );

    if (outcome.status === "unauthenticated") {
      return json(401, { error: "unauthenticated" });
    }

    if (outcome.status !== "deleted") {
      return failure(outcome.status, isForm);
    }

    // The sessions are gone with the account; this only produces the headers
    // that clear the browser's cookie. Its failure must not hide the deletion.
    const cookies = await provider.signOut(request.headers).catch((error: unknown) => {
      logFailure("Clearing the session cookie after account deletion", error);

      return [] as string[];
    });

    // The event only, without an account id or an address.
    console.info(JSON.stringify({ event: "account.deleted" }));

    // The profile form draft goes too (L4): the device may be shared.
    return redirect(DELETED_LOCATION, [...cookies, clearedProfileDraftCookie()]);
  } catch (error) {
    logFailure("Account deletion", error);

    return isForm ? redirect(`${SCREEN}?blad=unavailable`) : json(503, { error: "unavailable" });
  }
}
