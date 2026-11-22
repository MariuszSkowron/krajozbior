"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requestedReturnTo } from "@/features/identity/domain/return-to";

import { LOGIN_EMAIL_COOKIE, LOGIN_EMAIL_PATH } from "./login-email-cookie";

/**
 * "Zmień adres" in step 2 of the e-mail sign-in: forgets the address kept between the steps and
 * goes back to step 1. A native form, so it works without JavaScript. The server action checks
 * the Origin header, and nothing here reads or writes data of an account.
 */
export async function changeLoginAddress(formData: FormData): Promise<void> {
  (await cookies()).delete({ name: LOGIN_EMAIL_COOKIE, path: LOGIN_EMAIL_PATH });

  const returnTo = requestedReturnTo(formData.get("returnTo")?.toString());

  redirect(returnTo === null ? "/login" : `/login?${new URLSearchParams({ returnTo })}`);
}
