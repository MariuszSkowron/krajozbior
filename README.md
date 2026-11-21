# Krajozbiór

## W skrócie

Krajozbiór to aplikacja webowa do zbierania odwiedzonych miejsc w tematycznych kolekcjach, na komputer i telefon. To publiczne repozytorium kodu: aplikacja (Next.js, PostgreSQL z regułami dostępu, logowanie kodem z e-maila), testy, Storybook, CI i zasady pracy agentów AI. Kod jest publiczny tylko do wglądu (`LICENSE`). Dokumentacja produktu, decyzje i zadania są w osobnym, prywatnym repozytorium.

Projekt ma **dwa repozytoria, w dwóch folderach obok siebie**:

| Folder            | Repozytorium | Co zawiera                                                                    |
| ----------------- | ------------ | ----------------------------------------------------------------------------- |
| `krajozbior`      | publiczne    | kod, testy, CI, zasady pracy agentów (to repozytorium)                        |
| `krajozbior-docs` | prywatne     | produkt, decyzje, specyfikacje, runy, lekcje, raporty bezpieczeństwa, zadania |

Repozytorium powstało z szablonu `ai-repo-starter`.

## Jak działa Krajozbiór

- **Kolekcje.** Miejsca są zebrane w tematyczne kolekcje, np. „Wieże ciśnień Pomorza”. Jedno miejsce może należeć do kilku kolekcji.
- **Wizyty.** Odkrywca potwierdza wizytę lokalizacją telefonu na miejscu albo dopisuje wcześniejsze wizyty. Postęp w kolekcji widzi jako liczbę zebranych miejsc, np. 9/24.
- **Kuratorzy.** Gotowe kolekcje przygotowują kuratorzy: gminy, organizacje turystyczne i lokalni przewodnicy. Użytkownicy mogą też tworzyć własne kolekcje.

Działa pierwsza pełna ścieżka: kurator publikuje kolekcję, gość ją ogląda, a odkrywca zapisuje ją, potwierdza wizytę lokalizacją i widzi postęp. Pozostałe części pierwszej wersji są w przygotowaniu. Na początek aplikacja działa w przeglądarce na komputerze i telefonie.

## Dla oceniających

Jawny opis projektu dla osób, które go nie znają (produkt, architektura i ochrona danych, specyfikacje, proces z przeglądami, stan realizacji), jest w [docs/dla-oceniajacych/](docs/dla-oceniajacych/README.md). Uprawnienia agenta AI, miejsca przechowywania sekretów i wynik próby prompt injection opisuje [security-notes.md](security-notes.md).

## Codzienny start (Visual Studio Code)

1. Oba foldery leżą obok siebie: `krajozbior` i `krajozbior-docs`.
2. W folderze dokumentacji kliknij dwukrotnie plik `krajozbior.code-workspace` (albo w VS Code: **File → Open Workspace from File…** i wskaż ten plik). ✅ Po lewej widać dwa foldery: najpierw kod, potem dokumentację.
3. Otwórz panel Claude Code: ikona Claude na pasku bocznym albo `Ctrl+Shift+P` → „Claude Code: Open”. Agent pracuje w folderze kodu i ma dostęp do folderu dokumentacji.
4. Przy pierwszym otwarciu VS Code zaproponuje rekomendowane rozszerzenia (Claude Code, Prettier, ESLint, Playwright) — kliknij **Install**.

## Uruchomienie lokalne

Wymagania: Node.js (wersja jak w `.github/workflows/ci.yml`), npm, Docker Desktop (PostgreSQL 17 w kontenerze), Git.

```bash
npm ci
cp .env.example .env     # uzupełnij wartości lokalnie; pliku .env nie commituj
npm run db:roles         # tworzy role bazy krajozbior_owner, krajozbior_app, krajozbior_auth, krajozbior_ops
npm run db:migrate
npm run db:seed:demo     # konta demonstracyjne (tylko z ALLOW_DEMO_SEED=1 w .env)
npm run dev
```

Aplikacja działa pod adresem `http://localhost:3000`. Uwaga: `compose.yaml` jest tylko dla pracy deweloperskiej; testy integracyjne uruchamiaj na osobnej, jednorazowej bazie (`docs/testing.md`).

## Polecenia

| Polecenie                                                               | Co robi                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm run dev` / `build` / `start`                                       | serwer deweloperski, build produkcyjny, uruchomienie builda   |
| `npm run check`                                                         | format, lint, typy, testy jednostkowe z coverage i build      |
| `npm run format:check`, `lint`, `typecheck`                             | pojedyncze kontrole statyczne                                 |
| `npm run test:unit`, `test:coverage`                                    | testy jednostkowe Vitest, z progiem coverage logiki domenowej |
| `npm run test:integration`                                              | testy z prawdziwym PostgreSQL (harness ról)                   |
| `npm run test:e2e`                                                      | Playwright na zbudowanej aplikacji                            |
| `npm run storybook`, `build-storybook`                                  | podgląd i build Storybooka                                    |
| `npm run db:roles`, `db:migrate`, `db:migration:create`, `db:seed:demo` | role, migracje i konta demo                                   |
| `npm run auth:create-admin -- --email <e-mail>`                         | konto administratora (hasło z `ADMIN_PASSWORD`)               |
| `npm run auth:throttle -- <polecenie>`                                  | blokada i odblokowanie limitów logowania i próśb o kod        |

Na Windows lokalne środowisko testowe (integracja i E2E): `powershell -ExecutionPolicy Bypass -File scripts/test-env/test-env-test.ps1`.

## Struktura

```text
AGENTS.md, CLAUDE.md      zasady pracy agenta (CLAUDE.md odsyła do AGENTS.md)
SDLC.md                   proces: zadanie -> specyfikacja -> implementacja -> przegląd -> poprawki -> auto-merge
docs/                     architektura, standardy, testy, izolacja danych, design system, przepływ agentów, opis dla oceniających
.ai/                      publiczna konfiguracja skilli agentów (reszta .ai/ jest lokalna i ignorowana)
.claude/                  uprawnienia (settings.json), hooki strażnicze, skille
.github/                  CI, guard, CodeQL, CODEOWNERS, szablon PR, Dependabot, ruleset ochrony main, bot.json
.vscode/extensions.json   rekomendowane rozszerzenia VS Code
scripts/                  db-roles, setup-github.ps1, bot-token.ps1, test-env/
LICENSE                   wszelkie prawa zastrzeżone (kod publiczny tylko do wglądu)
src/                      app (routing), features (domeny), design-system, lib (infrastruktura)
tests/, e2e/              testy jednostkowe i integracyjne, testy przeglądarkowe
```

## Zasady w skrócie

Agent nigdy nie pushuje do `main`, nie scala i nie zatwierdza PR. Wolno mu tylko włączyć auto-merge; GitHub scala PR, gdy przejdą testy, przeglądy agentów i, dla zmian wrażliwych, zatwierdzenie właściciela. Agenci pracują na GitHub jako aplikacja GitHub projektu (bot), a token odnawia `scripts/bot-token.ps1`. Szczegóły: `AGENTS.md`, `SDLC.md`, `docs/agent-workflow.md`.

## Licencja

Wszelkie prawa zastrzeżone (`LICENSE`). Kod jest publiczny tylko do wglądu: bez pisemnej zgody właściciela nie wolno go używać, kopiować, zmieniać ani rozpowszechniać.
