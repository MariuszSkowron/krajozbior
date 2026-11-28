// Identyfikator próby wizyty (idempotencja zapisu). `crypto.randomUUID` nie istnieje w Safari/iOS
// przed 15.4 ani poza bezpiecznym kontekstem (HTTP w sieci lokalnej), więc przy jego braku
// składamy UUID v4 z `crypto.getRandomValues`. Gdy nie ma i tego, rzuca błąd: wywołujący
// pokazuje komunikat i przywraca przycisk.
export function newClientVisitId(source: Partial<Crypto> | undefined): string {
  if (typeof source?.randomUUID === "function") {
    return source.randomUUID();
  }

  if (typeof source?.getRandomValues !== "function") {
    throw new Error("No source of random values");
  }

  const bytes = source.getRandomValues(new Uint8Array(16));

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
