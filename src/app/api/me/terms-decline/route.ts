import { handleTermsDecline } from "@/features/terms/http/terms-http";

export const dynamic = "force-dynamic";

// „Nie akceptuję” na ekranie „Zanim zaczniesz”: wylogowuje i usuwa konto, które nigdy niczego
// nie zaakceptowało. Ciało nie wskazuje konta: usuwane jest konto z sesji.
export async function POST(request: Request) {
  return handleTermsDecline(request);
}
