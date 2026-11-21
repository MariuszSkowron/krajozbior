# Proces, przeglądy i bezpieczeństwo

## W skrócie

Kod piszą agenci AI (Claude Code), a właściciel projektu podejmuje decyzje produktowe i zatwierdza zmiany wrażliwe. Każda zmiana przechodzi przez PR (propozycję zmiany w kodzie, którą ktoś sprawdza przed scaleniem) z automatycznymi testami i przeglądem innego agenta niż autor; zmiany dotyczące danych prywatnych, uprawnień i bazy przegląda najmocniejszy model, osobno pod kątem jakości i bezpieczeństwa. Granicą bezpieczeństwa nie jest dobra wola agenta, tylko ustawienia GitHuba: zmian wrażliwych nie da się scalić bez kliknięcia właściciela.

Pełny opis: [docs/agent-workflow.md](../agent-workflow.md) i [SDLC.md](../../SDLC.md).

## Od zadania do scalenia

1. **Zadanie i specyfikacja.** Zadania są w prywatnym repozytorium (w publicznych tekstach oznaczone `docs#N`). Większa zmiana ma specyfikację z przeglądem innego modelu (zob. [Specyfikacje](specyfikacje.md)).
2. **Implementacja.** Agent pracuje we własnej kopii roboczej, uruchamia kontrole lokalnie i otwiera PR jako szkic.
3. **Przegląd.** Poziom zależy od ryzyka: **A** (logowanie, dane prywatne, uprawnienia, baza, trasy API) to dwa osobne przeglądy najmocniejszego modelu, kodu i bezpieczeństwa; **B** (zwykłe funkcje i ekrany) to jeden przegląd obejmujący oba tematy; **C** (dokumentacja) to przegląd orkiestratora.
4. **Poprawki** wprowadza świeży agent, a na poziomie A sprawdza je kolejny, niezależny agent.
5. **Scalenie.** GitHub scala PR sam, gdy przejdą wszystkie wymagane kontrole (testy, skan sekretów, kontrola czystości repozytorium, statusy przeglądów) i, dla ścieżek wrażliwych, gdy właściciel zatwierdzi zmianę. Agent nie może scalić ani zatwierdzić PR-a.

## Repozytorium gotowe do pracy z agentami

- **Zasady:** [AGENTS.md](../../AGENTS.md) mówi agentowi, co wolno, jak pisać i testować kod, jak prowadzić specyfikacje i dzienniki oraz jak dobrać model do zadania (Opus do projektowania i przeglądów wrażliwych zmian, Sonnet do implementacji według specyfikacji, Haiku do prac mechanicznych). Przepływ od zadania do scalenia: [docs/agent-workflow.md](../agent-workflow.md).
- **Skille** (gotowe instrukcje dla agenta do powtarzalnych zadań): własny skill projektu [`private-data`](../../.claude/skills/private-data/SKILL.md) prowadzi agenta przy każdej funkcji z danymi prywatnymi, od klasyfikacji danych przez migrację z regułami dostępu po wymagany test odmowy. Skille `om-*` w [`.claude/skills/`](../../.claude/skills/) obsługują pisanie i przegląd specyfikacji (`om-spec-writing`), backlog (`om-backlog`), przegląd kodu (`om-code-review`), raport bezpieczeństwa (`om-auto-sec-report-pr`) i otwieranie PR-ów. Zlecenie dla agenta podaje, który skill ma wczytać jako pierwszy; sprawdzamy to w zapisie jego sesji.
- **Hooki:** sześć programów w [`.claude/hooks/`](../../.claude/hooks/) sprawdza każde polecenie agenta przed wykonaniem, np. blokuje migrację tabeli bez reguł dostępu albo zmianę plików poleceniami terminala. Lista z opisem i testami: [security-notes.md](../../security-notes.md).
- **Praca równoległa:** każdy agent pracuje we własnej kopii repozytorium (worktree), z własną bazą testową i portem, więc agenci nie przeszkadzają sobie nawzajem.

## Zabezpieczenia procesu

- **Osobna tożsamość agentów.** Agenci działają na GitHubie jako aplikacja projektu z wąskimi uprawnieniami, z tokenem ważnym godzinę. Nie mogą zatwierdzać PR-ów ani zmieniać ustawień repozytorium.
- **Właściciel kodu.** Plik `.github/CODEOWNERS` wskazuje ścieżki wrażliwe; zmiana w nich czeka na zatwierdzenie właściciela, a każdy nowy commit w PR unieważnia to zatwierdzenie.
- **Czystość repozytorium publicznego.** Osobne zadanie CI (automatycznych kontroli GitHuba uruchamianych przy każdym PR; zadanie `guard`) odrzuca PR, gdy trafia do niego plik prywatny albo odwołanie do prywatnego repozytorium. Skan sekretów obejmuje całą historię.
- **Hooki agenta.** Lokalne reguły blokują agentowi m.in. czytanie plików z sekretami, zmianę własnych ustawień i scalanie PR-ów. Od PR #33 blokują też zmianę plików projektu poleceniami terminala (np. dopisywanie tekstu przekierowaniem), bo agenci kilka razy złamali ten zakaz mimo zapisu w zasadach. Zostają im zwykłe narzędzia edycji, których pilnują pozostałe zabezpieczenia. Hook chroni przed pomyłką, nie przed zdeterminowanym obejściem; granicą pozostaje ustawienie GitHuba.

## Wyniki przeglądów kodu

Numery to publiczne numery PR-ów w tym repozytorium. Uwagi drobne i kosmetyczne nie blokują scalenia; autor poprawia je w tym samym PR albo przenosi do kolejnych.

- **#10, organizacje i polecenie operatora** (poziom A, Opus): zatwierdzony; 0 blokujących, 0 ważnych, 5 drobnych, 4 kosmetyczne.
- **#11, katalog kolekcji i miejsc** (poziom A, Opus): zatwierdzony; 0 blokujących, 0 ważnych, tylko drobne i kosmetyczne.
- **#13, panel kuratora** (poziom B): zatwierdzony; 0 blokujących, 0 ważnych, 4 drobne, 2 kosmetyczne.
- **#14, strony publiczne** (poziom B, Sonnet): zatwierdzony; 0 blokujących, 0 ważnych, 4 drobne.
- **#15, album odkrywcy w bazie** (poziom A, Opus): zatwierdzony; 0 blokujących, 0 ważnych, 4 drobne, 3 kosmetyczne.
- **#16, „Moje kolekcje”** (poziom B): zatwierdzony; 0 blokujących, 0 ważnych, 3 drobne.
- **#17, wizyta na miejscu i test całej ścieżki** (poziom A, Opus): zatwierdzony; 0 blokujących, 0 ważnych, 4 drobne, 2 kosmetyczne.
- **#18, „Chcę zobaczyć”** (poziom B): najpierw do poprawy (1 uwaga ważna: odwiedzonego miejsca nie dało się usunąć z listy), po poprawce zatwierdzony.
- **#22, dziennik operacji** (poziom A, Opus): zatwierdzony; tylko uwagi drobne i kosmetyczne.
- **#25, tokeny, kroje i przełącznik motywu** (poziom B, Sonnet): zatwierdzony; uwagi drobne poprawione, a słabą asercję testu fokusu wzmocniono z dowodem, że wykrywa błąd.
- **#27, limity list i zapisu oraz bezpieczniejszy zapis do albumu** (poziom A): zatwierdzony; poprawki sprawdził niezależnie kolejny agent.
- **#28, nocny album: nawigacja, menu kuratora i wspólne elementy (E3-2a)** (poziom B): zatwierdzony; poprawki sprawdził niezależnie kolejny agent.
- **#29, adres kolekcji z aktualnego tytułu przy pierwszej publikacji** (poziom A): zatwierdzony; poprawki sprawdził niezależnie kolejny agent.
- **#31, nocny album: ekrany ścieżki i test dostępności (E3-2b)** (poziom B): zatwierdzony.
- **#32, przypięty przycisk wizyty na telefonie** (poziom B, Sonnet): uwagi poprawione i sprawdzone niezależnie; zatwierdzony. Zmiana tylko w warstwie wyglądu.
- **#33, hook blokujący zapis plików z terminala**: trzy rundy poprawek, każda z niezależną weryfikacją; zatwierdzony.
- **#34, wizyta z przeszłości** (poziom A, Opus, plus przegląd bezpieczeństwa): poprawki sprawdził niezależnie kolejny agent; zatwierdzony.
- **#38–#41 i #49, epik E12 „Odkrywanie”** (poziom A, Opus): cztery PR-y zatwierdzone przy pierwszym przeglądzie (bez uwag blokujących i średnich), mapa (#49) po poprawce dwóch uwag średnich przed scaleniem. Szczegóły: [Specyfikacja E12](specyfikacja-e12-odkrywanie.md#przeglądy-pr-ów-epiku).

Późniejsze PR-y z kodem miały przegląd innego modelu niż autor (zwykle autor Sonnet, recenzent Opus; przy #60 recenzentem był Claude Fable, czyli inny model Claude). Wynik pierwszego przeglądu:

- **zatwierdzone od razu:** #47 (baza pod wgrywanie kolekcji; tylko uwagi drobne), #54 (statystyki profilu; 1 uwaga średnia, 6 drobnych), #56 (właściciel kodu dla całego repozytorium);
- **zatwierdzone po poprawkach** (większe poprawki sprawdzał kolejny, niezależny agent): #50 (profil; 2 uwagi średnie), #53 (wgrywanie kolekcji z pliku; przegląd w dwóch paczkach: łącznie 4 średnie i 15 drobnych), #55 (obraz produkcyjny i konfiguracja serwera; 2 średnie), #57 (wysyłka kodów logowania; 2 ważne), #58 (strony prawne i akceptacja regulaminu; 1 blokująca, bo nie uruchomiono jeszcze testów z bazą, E2E i budowy, oraz 2 ważne, 7 drobnych i 2 kosmetyczne), #60 (logi i limity; 1 blokująca w dokumentacji i teście), #61 (limit czasu zapytań; 1 drobna w dokumentacji), #63 (publiczne notatki bezpieczeństwa).

Uwagi blokujące i ważne poprawiono przed scaleniem, a większe poprawki sprawdził niezależny agent. Treść uwag dotyczących bezpieczeństwa publikujemy tylko w tej ogólnej postaci.

## Przegląd bezpieczeństwa ścieżki konkursowej

Po zakończeniu ośmiu PR-ów ścieżki konkursowej (#10–#18) osobny agent wykonał przegląd bezpieczeństwa całości według kategorii OWASP (powszechnie używanej listy najczęstszych zagrożeń aplikacji internetowych). Wynik:

- **0 krytycznych i 0 wysokich.**
- **1 średnie:** dotyczyło tego, że wiarygodność dziennika operacji da się poprawić. Właściciel zdecydował o poprawce przed konkursem; poprawka powstała według osobnej specyfikacji i weszła w PR #22.
- **5 drobnych i 3 informacyjne:** zaplanowane do poprawy albo świadomie zaakceptowane przez właściciela.

Część uwag drobnych została już poprawiona. PR #27 wprowadził górne limity długości list i liczby zapisów oraz bezpieczniejszy zapis do albumu (zapis z warunkiem w jednym poleceniu bazy). PR #29 sprawia, że adres kolekcji powstaje z jej aktualnego tytułu przy pierwszej publikacji.

Recenzent sprawdził m.in. obejście reguł dostępu w bazie, funkcje działające z wyższymi uprawnieniami, wyliczanie cudzych identyfikatorów, masowe przypisanie pól, sesję i ochronę przed fałszywymi żądaniami, przekierowania, wycieki w komunikatach błędów, nagłówki, ochronę danych lokalizacji, konta demonstracyjne na produkcji i sekrety w kodzie. Raport z ustaleniami jest prywatny; publikujemy tylko wynik, żeby nie ujawniać szczegółów uwag, które mogą być jeszcze otwarte.

## Zbiorczy przegląd bezpieczeństwa PR #10–#32

Później osobny agent przejrzał pod kątem bezpieczeństwa wszystkie zmiany scalone w PR-ach #10–#32. Wynik ogólny: **brak ustaleń krytycznych, wysokich i średnich**; zostały pojedyncze uwagi drobne i informacyjne, zaplanowane albo świadomie przyjęte. Raport jest prywatny z tego samego powodu co poprzedni.
