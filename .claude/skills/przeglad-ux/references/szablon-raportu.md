# Szablon raportu i skala wag

Kroki 6–7 skilla `przeglad-ux`: jak ważyć ustalenia, jak wygląda raport w `<docs>/.ai/qa/` i co może trafić do repozytorium publicznego. Raport pisz według `AGENTS.md`, sekcja „Styl tekstów”: pełne zdania, bez kalk z angielskiego, nazwy plików w nawiasach.

## Skala wag (wpływ na użytkownika)

| Waga      | Kiedy                                                                                                                           | Przykład                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Krytyczna | Użytkownik nie wykona zadania albo traci dane; błąd 5xx; treść znika lub zasłania inną                                          | nie da się zapisać wizyty na telefonie                                                           |
| Wysoka    | Zadanie wykonalne, ale łatwo się pomylić lub nie zauważyć wyniku; brak obsługi klawiaturą; kontrast poniżej AA; błędy w konsoli | zapis wizyty bez widocznej zmiany przycisku (Z-2); nagłówek i profil różnie opisują rolę (Z-8)   |
| Średnia   | Zbędny wysiłek lub zamęt, ale wynik jest jasny                                                                                  | filtr przenosi na górę strony (Z-4); ciągłe przełączanie listy i mapy na szerokim ekranie (Z-12) |
| Niska     | Niespójność wyglądu, drobny szum                                                                                                | link w domyślnym stylu przeglądarki (Z-11)                                                       |

W obrębie wagi szereguj według liczby użytkowników, których dotyczy (gość i odkrywca przed kuratorem), i według tego, jak często ekran jest używany.

## Szablon pliku `<docs>/.ai/qa/YYYY-MM-DD-przeglad-ux.md`

```markdown
# Przegląd UX aplikacji (YYYY-MM-DD)

## W skrócie

<3–5 zdań prostą polszczyzną dla właściciela: jaki jest ogólny stan, co najbardziej przeszkadza użytkownikom, ile jest problemów poważnych, czego potrzeba od właściciela (decyzje).>

## Wynik

Wynik: Zaliczony | Zaliczony z uwagami | Niezaliczony | Niepełny
Ustalenia: krytyczne N, wysokie N, średnie N, niskie N
Samokontrola: wstępnych N, zostało N (ogólnych usunięto N, duplikatów N)
Zakres: role <lista>; trasy sprawdzone N z M; warianty <lista>
Nie sprawdzono: <co i dlaczego, albo „—”>
Środowisko: stanowisko <nazwa>, commit <skrót>, data i godzina
Stan repozytorium: wynik `git status` po przeglądzie (czysty | lista plików); zostawiony katalog tymczasowy: `.ai/tmp/przeglad-ux/`

## Pięć najważniejszych

1. [UX-01] <tytuł> — <jedno zdanie, dlaczego to najważniejsze>
   ...

## Ustalenia

### [UX-01] <tytuł opisujący problem z perspektywy użytkownika>

- **Waga:** krytyczna | wysoka | średnia | niska
- **Ekran:** <nazwa ekranu po polsku> (`/trasa`), rola, wariant (telefon/komputer, motyw)
- **Dowód:** ![opis](YYYY-MM-DD-przeglad-ux/<plik>.png) — przed i po, jeśli dotyczy akcji
- **Kroki:** 1. … 2. … 3. …
- **Zasada:** Z-n <treść skrócona> | lista wizualna, punkt | dostępność, punkt (WCAG x.y.z)
- **Skutek dla użytkownika:** <co się dzieje z osobą, która korzysta z ekranu>
- **Proponowane rozwiązanie [P]:** <konkretna zmiana zachowania lub wyglądu, nie „poprawić X”>
- **Kryterium akceptacji:** <sprawdzalne zdanie, np. „po kliknięciu filtra położenie przewinięcia się nie zmienia, a lista pokazuje tylko odwiedzone”>
- **Powiązania:** <docs#N, specyfikacja, jeśli są>

## Pytania do właściciela

- **P-1 (<temat>).** <pytanie>. Rekomendacja: <opcja>. Skutek: <co się zmieni przy każdej opcji>.

## Co działa dobrze

<krótka lista ekranów lub wzorców do zachowania, z dowodem; bez pochwał ogólnych>

## Do innych przeglądów

<jedna linia na problem z polszczyzną, tonem albo wypełniaczem zauważony przy okazji: ekran, cytat, skill (`przeglad-polszczyzny`, `przeglad-tonu`, `przeglad-wypelniaczy`); albo „—”>

## Mapa pokrycia

| Trasa | Rola | Telefon | Komputer | Nocny | Jasny | Klawiatura | Stany |
| ----- | ---- | ------- | -------- | ----- | ----- | ---------- | ----- |
```

## Reguły ustaleń

- Rozwiązanie to propozycja **[P]**. Gdy zmienia wymaganie **[Z]** z `product.md` albo decyzję `D-NN`, napisz to wprost i dodaj pytanie do właściciela.
- Bez „rozważyć”, „poprawić”, „ulepszyć”: rozwiązanie mówi, co ma się stać.
- Kryterium akceptacji da się sprawdzić w przeglądarce albo testem E2E.
- Jedna przyczyna = jedno ustalenie, nawet gdy występuje na kilku ekranach (wypisz je w polu „Ekran”).
- Problemy z polszczyzną, tonem i wypełniaczami zostaw skillom `przeglad-polszczyzny`, `przeglad-tonu` i `przeglad-wypelniaczy`; możesz je wymienić jedną linią w sekcji „Do innych przeglądów”.

## Skrót publiczny (PR, zadanie lub komentarz w repozytorium kodu)

Tylko gdy zlecenie tego wymaga. Bez linku do `<docs>`, bez treści prywatnej, bez szczegółów bezpieczeństwa, bez danych z kont demo poza nazwą roli.

```markdown
Przegląd UX całej aplikacji (YYYY-MM-DD): wynik <wynik>; ustalenia: krytyczne N, wysokie N, średnie N, niskie N.

Najważniejsze dla użytkownika:

- <problem jednym zdaniem, bez nazw prywatnych>
- …

Pełny raport w repozytorium dokumentacji.
```
