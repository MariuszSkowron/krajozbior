// Pomocniczy proces potomny testów: nigdy nie odpowiada (symuluje zawieszoną bibliotekę natywną).
process.once("message", () => {
  setInterval(() => {}, 1000);
});
