// Pomocniczy proces potomny testów: zapisuje nazwy zmiennych środowiska, które dostał, do pliku
// z `inputPath` (odpowiedź IPC musi zachować kontrakt), po czym odsyła poprawny wynik.
import { writeFileSync } from "node:fs";

process.once("message", (message) => {
  writeFileSync(
    message.inputPath,
    JSON.stringify({ envKeys: Object.keys(process.env), execArgv: process.execArgv }),
  );
  process.send?.(
    {
      ok: true,
      result: {
        main: new Uint8Array(1),
        thumb: new Uint8Array(1),
        width: 1,
        height: 1,
        quality: 80,
      },
    },
    undefined,
    undefined,
    () => process.exit(0),
  );
});
