// Pomocniczy proces potomny testów: odpowiada nieznanym kodem błędu.
process.once("message", () => {
  process.send?.({ ok: false, code: "nieznany" }, undefined, undefined, () => process.exit(0));
});
