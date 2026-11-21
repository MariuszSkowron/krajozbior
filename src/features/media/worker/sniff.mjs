// @ts-check
// Typ pliku po zawartości (nie po rozszerzeniu ani nagłówku przeglądarki), 5.3 krok 4.
// Moduł bez importów.

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * @param {Uint8Array} bytes
 * @param {number[]} signature
 */
function startsWith(bytes, signature) {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

/**
 * Przegląda bloki PNG przed pierwszym blokiem `IDAT`; blok `acTL` oznacza animowany PNG.
 * `libvips` czyta APNG jak zwykły obraz, więc wykrywamy go sami.
 * @param {Uint8Array} bytes
 */
function hasAnimationControl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + length;
  }
  return false;
}

/**
 * @param {Uint8Array} bytes
 * @returns {"jpeg" | "png" | "apng" | "unsupported"}
 */
export function sniffImageType(bytes) {
  if (startsWith(bytes, JPEG_SIGNATURE)) return "jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return hasAnimationControl(bytes) ? "apng" : "png";
  return "unsupported";
}
