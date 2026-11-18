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

## Zabezpieczenia procesu

- **Osobna tożsamość agentów.** Agenci działają na GitHubie jako aplikacja projektu z wąskimi uprawnieniami, z tokenem ważnym godzinę. Nie mogą zatwierdzać PR-ów ani zmieniać ustawień repozytorium.
- **Właściciel kodu.** Plik `.github/CODEOWNERS` wskazuje ścieżki wrażliwe; zmiana w nich czeka na zatwierdzenie właściciela, a każdy nowy commit w PR unieważnia to zatwierdzenie.
- **Czystość repozytorium publicznego.** Osobne zadanie CI (automatycznych kontroli GitHuba uruchamianych przy każdym PR; zadanie `guard`) odrzuca PR, gdy trafia do niego plik prywatny albo odwołanie do prywatnego repozytorium. Skan sekretów obejmuje całą historię.
- **Hooki agenta.** Lokalne reguły blokują agentowi m.in. czytanie plików z sekretami, zmianę własnych ustawień i scalanie PR-ów.

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

## Przegląd bezpieczeństwa ścieżki konkursowej

Po zakończeniu ośmiu PR-ów ścieżki konkursowej (#10–#18) osobny agent wykonał przegląd bezpieczeństwa całości według kategorii OWASP (powszechnie używanej listy najczęstszych zagrożeń aplikacji internetowych). Wynik:

- **0 krytycznych i 0 wysokich.**
- **1 średnie:** dotyczyło tego, że wiarygodność dziennika operacji da się poprawić. Właściciel zdecydował o poprawce przed konkursem; poprawka powstała według osobnej specyfikacji i weszła w PR #22.
- **5 drobnych i 3 informacyjne:** zaplanowane do poprawy albo świadomie zaakceptowane przez właściciela.

Część uwag drobnych została już poprawiona. PR #27 wprowadził górne limity długości list i liczby zapisów oraz bezpieczniejszy zapis do albumu (zapis z warunkiem w jednym poleceniu bazy). PR #29 sprawia, że adres kolekcji powstaje z jej aktualnego tytułu przy pierwszej publikacji.

Recenzent sprawdził m.in. obejście reguł dostępu w bazie, funkcje działające z wyższymi uprawnieniami, wyliczanie cudzych identyfikatorów, masowe przypisanie pól, sesję i ochronę przed fałszywymi żądaniami, przekierowania, wycieki w komunikatach błędów, nagłówki, ochronę danych lokalizacji, konta demonstracyjne na produkcji i sekrety w kodzie. Raport z ustaleniami jest prywatny; publikujemy tylko wynik, żeby nie ujawniać szczegółów uwag, które mogą być jeszcze otwarte.
