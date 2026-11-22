import { handleMediaRequest } from "@/features/photos/http/media-http";

// Odpowiedź zależy od sesji (zdjęcie szkicu widzi tylko zespół organizacji), więc trasa nigdy nie
// jest renderowana statycznie. `Cache-Control` ustawia sama trasa.
export const dynamic = "force-dynamic";

// Opcjonalny catch-all: trasa obsługuje KAŻDY adres pod `/media` (także `/media` i adresy o złej
// liczbie segmentów), więc żadna odpowiedź stąd nie jest stroną HTML z powłoką aplikacji. Adres
// inny niż `/media/{kind}/{photoId}/{size}` dostaje to samo 404 `text/plain` z CSP `sandbox`.
type Context = { params: Promise<{ parts?: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return handleMediaRequest(request, (await params).parts ?? []);
}
