// Pomocniczy proces potomny testów: kończy się błędem bez odpowiedzi.
process.once("message", () => {
  process.exit(3);
});
