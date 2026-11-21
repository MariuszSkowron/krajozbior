// Pomocniczy proces potomny testów: odsyła nazwy zmiennych środowiska, które dostał.
process.once("message", () => {
  process.send?.(
    { ok: true, result: { envKeys: Object.keys(process.env), execArgv: process.execArgv } },
    undefined,
    undefined,
    () => process.exit(0),
  );
});
