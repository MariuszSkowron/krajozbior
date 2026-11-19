import { handleAccountDeletion } from "@/features/account/http/delete-account-http";

export const dynamic = "force-dynamic";

// Deletes the signed-in account (E9-5). The body holds the confirmation word and
// no account id: the account is always the one of the session.
export async function POST(request: Request) {
  return handleAccountDeletion(request);
}
