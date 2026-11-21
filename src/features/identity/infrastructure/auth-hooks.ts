import "server-only";

import { APIError, type BetterAuthOptions } from "better-auth";

import type { EmailSender } from "@/lib/email/email-sender";
import { renderSignInCodeEmail } from "@/lib/email/sign-in-code-email";
import { logFailure } from "@/lib/log-failure";

import { isStaffRole, limitSessionExpiry, maySignInOnPath } from "../domain/session-policy";

// Better Auth database hooks and the sign-in code callback. The hooks are the
// first line of defence; the checks of our routes and of getActor are the
// second.
//
// `context` is Better Auth's endpoint context. It is absent when trusted server
// code calls the internal adapter directly (the demo seed): the public router
// is not mounted, so every request of a person goes through `auth.api.*` and
// always has a context.
// Trust assumption: the hooks cannot tell a trusted caller from a route that
// wrongly calls the internal adapter functions createUser / createAccount /
// createOAuthUser / linkAccount itself. Only the demo seed and CLI scripts may
// do that; tests/features/identity/internal-adapter-allowlist.test.ts enforces it.
type DatabaseHooks = NonNullable<BetterAuthOptions["databaseHooks"]>;
type EndpointContext = Parameters<
  NonNullable<NonNullable<NonNullable<DatabaseHooks["user"]>["create"]>["before"]>
>[1];
type ActiveContext = NonNullable<EndpointContext>;

export type AuthHookDeps = Readonly<{
  now?: () => Date;
}>;

const forbidden = (message: string) => new APIError("FORBIDDEN", { message });

async function roleOfUser(context: ActiveContext, userId: string): Promise<unknown> {
  const user = await context.context.internalAdapter.findUserById(userId);

  return (user as { role?: unknown } | null)?.role;
}

export function createDatabaseHooks(deps: AuthHookDeps = {}): DatabaseHooks {
  const now = deps.now ?? (() => new Date());

  return {
    user: {
      create: {
        // An account created by a sign-in flow (the sign-in code) is always a
        // `user` with a verified address; name and image never come from the
        // client. The role is never written: the database default `user`
        // applies, and krajozbior_auth has no INSERT privilege on `role` anyway.
        before: async (user, context) => {
          if (!context) {
            return;
          }
          if (user.emailVerified !== true) {
            throw forbidden("email_not_verified");
          }

          return { data: { ...user, image: null, name: "", role: undefined } };
        },
      },
    },
    session: {
      create: {
        // Admins get a session only from the password sign-in, for 12 hours.
        before: async (session, context) => {
          if (!context) {
            throw forbidden("session_without_request");
          }

          const role = await roleOfUser(context, session.userId);
          if (!maySignInOnPath(role, context.path)) {
            throw forbidden("staff_password_only");
          }

          const expiresAt = limitSessionExpiry(
            role,
            new Date(session.createdAt ?? now()),
            new Date(session.expiresAt),
          );
          if (expiresAt === null) {
            throw forbidden("unknown_role");
          }

          return { data: { ...session, expiresAt } };
        },
      },
      update: {
        // A refresh never extends a session past its role's limit from creation.
        before: async (session, context) => {
          if (session.expiresAt === undefined) {
            return;
          }

          const current = context?.context.session;
          if (current === null || current === undefined) {
            return false;
          }

          const expiresAt = limitSessionExpiry(
            (current.user as { role?: unknown }).role,
            new Date(current.session.createdAt),
            new Date(session.expiresAt),
          );
          if (expiresAt === null) {
            return false;
          }

          return { data: { ...session, expiresAt } };
        },
      },
    },
  };
}

export type SignInCodeDeps = Readonly<{
  emailSender: () => EmailSender;
  siteUrl: () => string;
}>;

type SendCodeContext = { context: ActiveContext["context"] } | undefined;

// The `sendVerificationOTP` callback of the email-otp plugin. Our route does
// not ask for a code for an admin; this is the second line: an admin address
// never gets a code. The message is handed over without waiting, so the
// response time does not depend on the provider.
//
// A failed delivery deliberately does not change the answer (OPS-7): an admin
// address sends nothing and so can never fail, so an answer that waited for the
// provider and reported its failure would tell, during an outage or by its
// timing, which addresses belong to admins. The person sees the usual "sent"
// with the hint to check spam and ask again; the failure goes to the log
// (`email.send_failed`; a refusal of the Brevo account is logged only as
// `email.brevo_rejected`, by the sender, for the hourly alarm).
export function createSendSignInCode(deps: SignInCodeDeps) {
  return async (
    data: { email: string; otp: string; type: string },
    context?: SendCodeContext,
  ): Promise<void> => {
    if (data.type !== "sign-in" || !context) {
      return;
    }

    const found = await context.context.internalAdapter.findUserByEmail(data.email);
    if (isStaffRole((found?.user as { role?: unknown } | undefined)?.role)) {
      console.info(JSON.stringify({ event: "auth.otp_staff_skipped" }));
      return;
    }

    void deliverSignInCode(deps, data.email, data.otp);
  };
}

async function deliverSignInCode(deps: SignInCodeDeps, to: string, code: string): Promise<void> {
  try {
    const email = renderSignInCodeEmail({ code, siteUrl: deps.siteUrl() });
    const result = await deps.emailSender().send({ to, tag: "sign_in_code", ...email });

    // A refusal of the account is already logged once by the sender as
    // `email.brevo_rejected` (counted by the hourly check): no second line.
    if (!result.ok && result.reason !== "brevo_rejected") {
      // The provider's reason only: never the address or the code.
      console.error(JSON.stringify({ event: "email.send_failed", reason: result.reason }));
    }
  } catch (error) {
    logFailure("email.send_sign_in_code", error);
  }
}
