# Zdjęcia: szkic (E4)

Dokument roboczy. Rośnie razem z fazami E4; specyfikacja leży w repozytorium dokumentacji (`docs#N`), tu jest tylko to, co dotyczy kodu i operacji.

## Gdzie leżą pliki

- Wolumen `krajozbior-media` (na pokazie `krajozbior-showcase-media`) pod `/var/lib/krajozbior/media` (`MEDIA_ROOT`). Właściciel `node`, uprawnienia `0700`. `app` czyta, `ops` zapisuje (E4-0b1, `docs/deployment.md`).
- Biblioteka obróbki zdjęć (zmniejszanie, usuwanie metadanych): E4-0a.

## Archiwum plików (E4-0b2)

- Nocne archiwum wolumenu na dysku serwera: pełne co niedzielę, przyrostowe w pozostałe noce, szyfrowane `age`. Opis, rotacja, alarm i odtwarzanie: `docs/deployment.md`, sekcja „Archiwum plików zdjęć na dysku serwera”.
- Funkcje: `kz_media_archive`, `kz_media_rotate`, `kz_media_restore_check`, `kz_media_chain_report` w `scripts/ops/server/lib.sh`; testy w `tests/scripts/ops-server-lib.test.ts`.
- Kopia leży na tym samym dysku co zdjęcia, więc nie chroni przed utratą dysku (kopia poza serwer: F-P1).

## Do uzupełnienia w kolejnych fazach

- Trasa `/media` i nagłówki (E4-2b), pobieranie z Commons (E4-2a, E4-2z), wgrywanie przez kuratorów i odkrywców (E4-1, E4-4), porządkowanie plików `photos:sweep` (tylko w `-Zdjecia`, bez uruchamiania po `-Commit`).
