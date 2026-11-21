// Pomocniczy proces potomny testów: odsyła sfałszowaną odpowiedź w trybie z FAKE_MODE
// (udaje przejęty proces, który łamie kontrakt odpowiedzi).
const good = () => ({
  main: new Uint8Array(10),
  thumb: new Uint8Array(5),
  width: 100,
  height: 80,
  quality: 80,
});

const modes = {
  good: () => ({ ok: true, result: good() }),
  "extra-field": () => ({ ok: true, result: { ...good(), polecenie: "x" } }),
  "extra-top": () => ({ ok: true, result: good(), dodatek: 1 }),
  oversize: () => ({ ok: true, result: { ...good(), main: new Uint8Array(400 * 1024) } }),
  "og-oversize": () => ({ ok: true, result: { ...good(), og: new Uint8Array(300 * 1024) } }),
  "text-main": () => ({ ok: true, result: { ...good(), main: "tekst" } }),
  "bad-width": () => ({ ok: true, result: { ...good(), width: 1.5 } }),
  "huge-width": () => ({ ok: true, result: { ...good(), width: 100000 } }),
  "bad-quality": () => ({ ok: true, result: { ...good(), quality: 99 } }),
  "no-result": () => ({ ok: true }),
  array: () => [1, 2],
};

process.once("message", () => {
  const reply = (modes[process.env.FAKE_MODE ?? "good"] ?? modes.good)();
  process.send?.(reply, undefined, undefined, () => process.exit(0));
});
