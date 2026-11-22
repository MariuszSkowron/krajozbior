import { COMMONS_UPLOAD_HOST } from "../domain/commons-url";

// Klient HTTP do pobierania miniatur z Wikimedia Commons (E4-2a, spec 5.11.5). Zasady:
// tylko `https://upload.wikimedia.org`, przekierowania krok po kroku (`redirect: "manual"`, najwyżej
// 3, każdy krok w obrębie tego samego hosta), limit 20 MB i 30 s na plik, 429 i 503 → czekanie
// według `Retry-After` (najwyżej 5 minut) i ponowienie. Błąd to zawsze krótki kod, bez adresów.

export type FetchFailureReason =
  | "bad_source"
  | "redirect_refused"
  | "http_error"
  | "rate_limited"
  | "too_large"
  | "timeout"
  | "network_error";

export type CommonsFetchResult =
  Readonly<{ ok: true; bytes: Uint8Array }> | Readonly<{ ok: false; reason: FetchFailureReason }>;

export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 3;
export const MAX_RETRY_AFTER_MS = 5 * 60_000;
/** Ile razy czekamy na `Retry-After` przy jednym pobraniu, zanim uznamy próbę za nieudaną. */
export const MAX_RATE_LIMIT_WAITS = 3;

export type CommonsClientOptions = Readonly<{
  /** Ogólna nazwa klienta i adres strony „Źródła danych” jako kontakt (bez danych właściciela). */
  userAgent: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
}>;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** `Retry-After` w sekundach albo jako data HTTP; brak lub nieczytelne → 1 s; zawsze ≤ 5 minut. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number {
  if (header === null) {
    return 1000;
  }

  const value = header.trim();
  let milliseconds: number;

  if (/^\d+$/.test(value)) {
    milliseconds = Number(value) * 1000;
  } else {
    const date = Date.parse(value);

    milliseconds = Number.isNaN(date) ? 1000 : Math.max(0, date - now);
  }

  return Math.min(milliseconds, MAX_RETRY_AFTER_MS);
}

/** Adres dozwolony: https, host `upload.wikimedia.org`, bez danych logowania i portu. */
export function isAllowedCommonsUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === COMMONS_UPLOAD_HOST &&
    url.username === "" &&
    url.password === "" &&
    url.port === ""
  );
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | "too_large"> {
  const declared = Number(response.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);

    return "too_large";
  }

  if (response.body === null) {
    return new Uint8Array(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.length;

    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);

      return "too_large";
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

export function createCommonsClient(options: CommonsClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_DOWNLOAD_BYTES;

  return {
    /** Pobiera plik pod adresem; wynik to bajty albo kod błędu. */
    async download(address: string): Promise<CommonsFetchResult> {
      const controller = new AbortController();
      // Jeden limit na całe pobranie (przekierowania, czytanie ciała); czekanie na `Retry-After`
      // go nie zjada, bo zegar liczy tylko czas aktywnego żądania.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let spent = 0;
      let startedAt = 0;
      const disarm = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
          spent += Date.now() - startedAt;
        }
      };
      const arm = () => {
        disarm();
        startedAt = Date.now();
        timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs - spent));
      };

      try {
        let current: URL;

        try {
          current = new URL(address);
        } catch {
          return { ok: false, reason: "bad_source" };
        }

        if (!isAllowedCommonsUrl(current)) {
          return { ok: false, reason: "bad_source" };
        }

        let redirects = 0;
        let waits = 0;

        for (;;) {
          arm();

          let response: Response;

          try {
            response = await fetchImpl(current.toString(), {
              redirect: "manual",
              signal: controller.signal,
              headers: { "User-Agent": options.userAgent, Accept: "image/jpeg,image/png" },
            });
          } catch {
            return { ok: false, reason: controller.signal.aborted ? "timeout" : "network_error" };
          }

          if (REDIRECT_STATUSES.has(response.status)) {
            await response.body?.cancel().catch(() => undefined);
            redirects += 1;

            const location = response.headers.get("location");

            if (redirects > MAX_REDIRECTS || location === null) {
              return { ok: false, reason: "redirect_refused" };
            }

            let next: URL;

            try {
              next = new URL(location, current);
            } catch {
              return { ok: false, reason: "redirect_refused" };
            }

            if (!isAllowedCommonsUrl(next)) {
              return { ok: false, reason: "redirect_refused" };
            }

            current = next;
            continue;
          }

          if (response.status === 429 || response.status === 503) {
            await response.body?.cancel().catch(() => undefined);
            waits += 1;

            if (waits > MAX_RATE_LIMIT_WAITS) {
              return { ok: false, reason: "rate_limited" };
            }

            disarm();
            await sleep(parseRetryAfter(response.headers.get("retry-after")));
            continue;
          }

          if (response.status !== 200) {
            await response.body?.cancel().catch(() => undefined);

            return { ok: false, reason: "http_error" };
          }

          try {
            const body = await readLimited(response, maxBytes);

            if (body === "too_large") {
              return { ok: false, reason: "too_large" };
            }

            return { ok: true, bytes: body };
          } catch {
            return { ok: false, reason: controller.signal.aborted ? "timeout" : "network_error" };
          }
        }
      } finally {
        disarm();
      }
    },
  };
}

export type CommonsClient = ReturnType<typeof createCommonsClient>;
