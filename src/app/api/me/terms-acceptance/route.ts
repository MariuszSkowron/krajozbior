import { handleTermsAcceptance } from "@/features/terms/http/terms-http";

export const dynamic = "force-dynamic";

// Akceptacja bieżącej wersji regulaminu przez zalogowane konto (F-K3, ekran „Zanim zaczniesz”).
// Ciało nie wskazuje właściciela ani wersji: konto akceptuje to, co serwis pokazał jako bieżące.
// POST przyjmuje natywny formularz ekranu (przekierowanie) albo JSON (status).
export async function POST(request: Request) {
  return handleTermsAcceptance(request);
}
