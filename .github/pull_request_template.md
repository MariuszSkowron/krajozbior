<!--
Repozytorium jest publiczne. Nie wklejaj tu linków do repozytorium dokumentacji,
treści specyfikacji, ustaleń przeglądu bezpieczeństwa ani planów produktu.
Zadanie zapisz zwykłym tekstem jako docs#N (bez słowa „Closes”).
-->

## Co się zmienia

1–3 zdania poprawną, prostą polszczyzną, zrozumiałe bez wiedzy technicznej (bez kalek z angielskiego):

- co robi ten PR — skutek dla użytkownika lub projektu, nie nazwy plików,
- dlaczego jest potrzebny,
- z czego wynika — zadanie, decyzja (D-NN), specyfikacja, błąd albo prośba właściciela.

Zadanie: docs#

## Testy i kontrole

- [ ] `npm run check` lokalnie (wynik i ograniczenia poniżej)
- [ ] Każdy nowy przypadek użycia (`src/features/**/application/`) ma test ścieżki sukcesu i odmowy.
- [ ] Test integracyjny odmowy dostępu, jeśli zmiana dotyczy danych prywatnych lub roli z zakresem.
- [ ] `npm run build-storybook`, jeśli zmiana dotyczy `src/design-system/` lub `.storybook/`.
- [ ] Testy ukierunkowane E2E lub integracyjne, jeśli zmiana dotyczy przepływu UI albo bazy (pełny zestaw uruchamia CI).
- [ ] Zmiana widoczna dla użytkownika (ekran, przepływ, tekst): przeglądy `om-ux-review-pr`, `przeglad-polszczyzny`, `przeglad-tonu`, `przeglad-wypelniaczy` wykonane albo „nie dotyczy” z powodem (`docs/agent-workflow.md`, etap 3).

Wynik lokalny / ograniczenia:

## Migracje

- [ ] Nie dotyczy.
- [ ] Dodano migrację i sprawdzono „revert + apply”. Czy usuwa dane? (tak/nie):

## Przegląd

- [ ] Ścieżki z `.github/CODEOWNERS`: PR czeka na zatwierdzenie właściciela (bez auto-merge).
- Statusy `agent-review` i `security-review` ustawia orkiestrator po przeglądach (`docs/agent-workflow.md`).

## Szczegóły techniczne

- Zmiany, decyzje techniczne, ryzyka:
