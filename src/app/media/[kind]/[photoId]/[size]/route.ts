import { handleMediaRequest } from "@/features/photos/http/media-http";

// Odpowiedź zależy od sesji (zdjęcie szkicu widzi tylko zespół organizacji), więc trasa nigdy nie
// jest renderowana statycznie. `Cache-Control` ustawia sama trasa; `src/proxy.ts` jej nie obejmuje.
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ kind: string; photoId: string; size: string }> };

export async function GET(request: Request, { params }: Context) {
  return handleMediaRequest(request, await params);
}
