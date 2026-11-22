# Dziennik zmian

Wszystkie istotne zmiany w Krajozbiorze są opisane w tym pliku. Format opiera się na [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), a numeracja wersji na [wersjonowaniu semantycznym](https://semver.org/lang/pl/). Numer w nawiasie (np. `#34`) to numer pull requesta, czyli propozycji zmiany w kodzie, na GitHubie.

Wersja 1.0.0 to pierwsze wydanie, w którym obiecujemy stabilny, opisany sposób działania aplikacji: ścieżka od utworzenia kolekcji przez kuratora do potwierdzenia wizyty przez odkrywcę, ochrona danych prywatnych i instrukcja uruchomienia. Kolejne wersje nie powinny tego psuć: drobne poprawki zwiększą trzecią cyfrę (1.0.1), nowe funkcje drugą (1.1.0), a zmiana łamiąca zgodność pierwszą (2.0.0). Wydanie 1.0 pokazuje zdjęcia miejsc z Wikimedia Commons; wgrywanie własnych zdjęć przez odkrywców przyjdzie w kolejnym wydaniu.

## [Nieopublikowane]

Na razie nie ma zmian w przygotowaniu: wszystkie scalone zmiany są opisane w wydaniu 1.0.0.

## [1.0.0] — w przygotowaniu

### Dodano

- Organizacje kuratorskie oraz polecenie, które nadaje uprawnienia kuratora (#10).
- Katalog kolekcji i miejsc prowadzony przez kuratora, z publikacją (#11) i panelem z edytorem kolekcji i miejsc (#13).
- Adres kolekcji powstaje z jej aktualnego tytułu przy pierwszej publikacji (#29).
- Publiczne strony kolekcji i miejsca, dostępne także dla gościa bez konta (#14).
- Album odkrywcy: zapisane kolekcje, lista „Chcę zobaczyć” i wizyty (#15, #16, #18).
- Ekran „Moje kolekcje” z postępem odkrywania (#16).
- Potwierdzanie wizyty na miejscu oraz test całej ścieżki konkursowej (#17).
- Wizyta z przeszłości: dodanie pojedynczej wizyty albo wielu naraz (#34).
- Przypięty przycisk wizyty na ekranie miejsca na telefonie (#32).
- Nowy wygląd „Nocny album”: kolory, kroje pisma i przełącznik motywu (#25), nawigacja, menu kuratora i wspólne elementy (#28) oraz ekrany głównej ścieżki z testem dostępności (#31).
- Strona główna z albumem i kolekcjami do odkrycia (#38) oraz kolekcjami w okolicy (#40).
- Wyszukiwarka kolekcji i miejsc (#39).
- Kolekcja jako album: filtr, siatka miejsc i panel miejsca (#41), a do tego mapa na stronie kolekcji (#49).
- Ekran Profil z wylogowaniem (#42), profil odkrywcy z imieniem, województwem i widocznością (#50) oraz statystyki: odkryte miejsca, województwa, kolekcje i kilometry (#54).
- Usunięcie konta z ekranu Ustawień (#43).
- Polecenie wgrywania kolekcji z pliku wraz z przygotowaniem bazy danych (#47, #53).
- Wysyłka kodów logowania e-mailem i sprawdzanie konfiguracji przy starcie aplikacji (#57).
- Strony prawne, stopka i akceptacja regulaminu przy rejestracji (#58).
- Obraz produkcyjny, konfiguracja serwera i trwały pokaz lokalny (#55).
- Dziennik operacji zapisywany przez osobną rolę operatora (#22).
- Wdrożenie na serwer jednym poleceniem i powrót do poprzedniej wersji (#62).
- Wgrywanie kolekcji z pliku na serwer: tryb serwera polecenia z dziennikiem operacji (#74) oraz jedno polecenie właściciela z podglądem i pytaniem „tak/nie”; kolekcje trafiają jako szkice, które właściciel publikuje sam (#77).
- Podpisy źródeł danych przy miejscach (wymóg licencji CC BY), odnośniki do Wikipedii i Wikidanych oraz publiczna strona „Źródła danych” ze stopki (#71).
- Motyw jasny lub nocny zapamiętany na koncie: po zalogowaniu na innym urządzeniu wybór jest ten sam; gość i pierwsza wizyta startują w motywie nocnym (#78).
- Oznaczenie „Nowa w okolicy” przy kolekcjach z ostatnich 30 dni w promieniu 50 km oraz filtr „Stan postępu” w „Moich kolekcjach” (#79).
- Ostrzeżenie przy miejscu prywatnym, ogrodzonym lub w ruinie: kurator ustawia „Wejście na teren”, odkrywca widzi prośbę, by nie wchodzić na teren (#85).
- Zdjęcia miejsc z Wikimedia Commons na stronie miejsca, z podpisem: autor, licencja i odnośnik do pliku źródłowego (#88).
- Przygotowanie do zdjęć miejsc, jeszcze niewidoczne dla użytkowników: miejsce na zdjęcia na serwerze (#81), biblioteka bezpiecznego zmniejszania zdjęć i usuwania z nich lokalizacji GPS i danych autora (#82) oraz dane, licencje i pobieranie zdjęć z Wikimedia Commons (#86).

### Zmieniono

- Statusy przeglądu zmian ustawiane jednym poleceniem właściciela (#66).
- Testy z bazą danych można uruchamiać na kilku stanowiskach naraz bez kolizji (#67), a pojedyncze pliki testów uruchamia się tym samym skryptem środowiska testowego (#80).
- Stabilniejsze testy, które nie zawodzą przy obciążonym komputerze ani serwerze CI: czas blokady zdalnego dostępu (#72, #87), oczekiwanie testów przeglądarkowych na konkretny stan strony (#73) oraz tytuły stron i dostęp do wizyt (#75).
- Aplikacja informuje w polityce prywatności, że przy wyświetlaniu mapy dane trafiają do serwerów OpenStreetMap (#64).
- Projekt ma właściciela dla całego repozytorium, a pliki umiejętności agentów AI są chronione przed niezatwierdzonymi zmianami (#56).
- Testy końcowe (E2E) zawsze działają z zabezpieczeniem bazy danych, a nazwy zmiennych wyglądu (tokenów) są czytelniejsze (#35).
- Testy wydajności wyszukiwarki mierzą stabilniej: po rozgrzewce i medianą zamiast wartości maksymalnej (#51).
- Reguła kodu wykrywa ręczne zabezpieczanie znaków przed zbudowaniem wyrażenia regularnego (#44).
- Automatyczna analiza kodu CodeQL sprawdza także szkice pull requestów (#45, #48).
- Automatyczne aktualizacje zależności są łączone w grupy, co zmniejsza liczbę osobnych zmian (#12).
- Wyniki testów końcowych (E2E) nie trafiają do repozytorium ani do formatowania (#19).

### Naprawiono

- Zapisy do albumu są bezpieczniejsze, a listy i zapisy mają limity (#27).
- Dzienniki (logi) aplikacji i bazy nie zawierają danych osobowych, a limity wielkości żądań i pamięci działają już przed otwarciem serwisu (#60).
- Zapytania aplikacji i logowania do bazy danych mają limit czasu, więc jedno zawieszone albo bardzo kosztowne zapytanie nie blokuje pozostałych użytkowników (#61).
- W dzienniku serwera po nieudanym zapytaniu zostaje tylko rodzaj błędu i kod, bez wartości wpisanych przez użytkownika; właściciel dostaje e-mail, gdy dzienna pula kodów logowania zbliża się do końca, a serwer zamyka połączenia, które zbyt długo nic nie przysyłają (#76).
- Formularze logowania, wylogowania i usuwania konta odrzucają nienormalnie duże żądania (odpowiedź 413), ekran usuwania konta nie wywraca się po wejściu w link ze specjalną wartością, a wyszukiwarka ma test na apostrofy i znaki specjalne (#83).
- Wygasłe sesje logowania są usuwane z bazy, zgodnie z polityką prywatności (#84).

### Bezpieczeństwo

- Blokada zdalnego dostępu i kluczy dla agenta AI pracującego nad kodem (#59).
- Agent AI nie ma już zgody na samodzielne ustawianie statusów przeglądu; ustawia je właściciel (#70).
- Wynik powtórzonej próby wstrzyknięcia poleceń (prompt injection) w jawnych notatkach o bezpieczeństwie (#65).
- Współrzędne wizyty nie trafiają do logów ani do odpowiedzi z błędem; chroni to test (#36).
- Zapisy w dzienniku operacji wykonuje osobna rola o ograniczonych uprawnieniach (#22).
- Hook blokuje zapis plików z powłoki, żeby agent AI nie obchodził przeglądu zmian (#33).
- Jawne notatki o bezpieczeństwie dla oceniających opisują uprawnienia agenta i przebieg próby wstrzyknięcia poleceń (#63).

### Dokumentacja

- Opis działania projektu w pliku README (#8) oraz jawna dokumentacja dla oceniających konkurs (#26), uzupełniana po kolejnych zmianach (#30, #37).
- Zasady pracy agentów AI: edycja plików, test regresji i zawężanie lokatorów w testach E2E (#24, #46).
- Opis wzorca danych prywatnych uwzględnia zapis przez rolę operatora (#23).
- Zasady pracy z botem projektu i wprowadzenie do opisu każdego pull requesta (#9).
- Dokumentacja dla oceniających: mapa wymogów konkursu, lista pozostałej pracy i opis planowanego epiku (#68).
- Założenie projektu i przygotowanie narzędzi agentów (#7).
