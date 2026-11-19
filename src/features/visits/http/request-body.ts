import "server-only";

// The bounded JSON body shared by the visit routes. A body that is not JSON is
// passed on as `undefined`: the use case answers 401 to a guest first and
// `invalid` (400) to a signed-in explorer. The body is read here, handed to the
// use case and dropped; it is never logged.

const HEADERS = { "Cache-Control": "private, no-store" };

export function privateJson(
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): Response {
  return Response.json(body, { status, headers: { ...HEADERS, ...extra } });
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ tooLarge: true } | { body: unknown }> {
  const read = await readBoundedText(request, maxBytes);

  if ("tooLarge" in read) {
    return read;
  }

  try {
    return { body: JSON.parse(read.text) as unknown };
  } catch {
    return { body: undefined };
  }
}

// The body as text, never more than `maxBytes` of it (counted while reading, so
// a missing or false Content-Length does not help).
export async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<{ tooLarge: true } | { text: string }> {
  if (Number(request.headers.get("content-length") ?? "0") > maxBytes) {
    return { tooLarge: true };
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();

  while (reader !== undefined) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > maxBytes) {
      await reader.cancel();

      return { tooLarge: true };
    }

    chunks.push(value);
  }

  return { text: Buffer.concat(chunks).toString("utf8") };
}
