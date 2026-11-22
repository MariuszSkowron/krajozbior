import "server-only";

import { logFailure } from "@/lib/log-failure";

import { servePhoto } from "../application/serve-photo";
import { notFoundHeaders, parseMediaRequest, photoHeaders } from "../domain/media-request";
import { getPhotoDeps } from "../infrastructure/photo-deps";

// GET /media/{kind}/{photoId}/{size}: reguły wejścia, decyzja o dostępie i nagłówki (5.4, 5.11.7).
// Zły adres daje to samo 404 co brak dostępu, brak pliku i brak `MEDIA_ROOT`, i to bez zapytania do
// bazy. Awaria bazy to 503 bez szczegółów (nigdy 500 z treścią błędu); zdjęcie nigdy nie trafia do
// pamięci współdzielonej po błędzie, bo każda odpowiedź błędu ma `private, no-store`.

function notFound(): Response {
  return new Response("Nie znaleziono.", { status: 404, headers: notFoundHeaders() });
}

export async function handleMediaRequest(
  request: Request,
  parts: readonly string[],
): Promise<Response> {
  // Tylko dokładnie trzy segmenty; każda inna liczba to to samo 404 co zły adres.
  const parsed = parts.length === 3 ? parseMediaRequest(parts[0]!, parts[1]!, parts[2]!) : null;

  if (parsed === null) {
    return notFound();
  }

  try {
    const result = await servePhoto(
      parsed,
      request.headers.get("if-none-match"),
      getPhotoDeps(request.headers),
    );

    switch (result.status) {
      case "not_found":
        return notFound();
      case "not_modified": {
        const headers = photoHeaders(result.visibility, result.etag);

        delete headers["Content-Type"];

        return new Response(null, { status: 304, headers });
      }
      case "ok":
        return new Response(result.file.body, {
          status: 200,
          headers: {
            ...photoHeaders(result.visibility, result.etag),
            "Content-Length": String(result.file.length),
          },
        });
    }
  } catch (error) {
    logFailure("Photo read", error);

    return new Response("Usługa chwilowo niedostępna.", {
      status: 503,
      headers: notFoundHeaders(),
    });
  }
}
