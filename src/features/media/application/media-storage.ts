import type { DiskSpace } from "../domain/free-space";
import type { MediaKind, MediaVariant } from "../domain/media-key";

/** Pliki jednego zdjęcia: plik główny, miniatura i (dla zdjęć oficjalnych) JPEG do `og:image`. */
export type MediaFiles = {
  main: Uint8Array;
  w400: Uint8Array;
  og?: Uint8Array;
};

/** Port magazynu plików zdjęć (D-E4-3). Adapter dyskowy: `infrastructure/disk-media-storage.ts`. */
export interface MediaStorage {
  /** Zapisuje wszystkie pliki zdjęcia albo żadnego. */
  store(kind: MediaKind, key: string, files: MediaFiles): Promise<void>;
  /** Usuwa katalog zdjęcia; brak katalogu nie jest błędem. */
  remove(kind: MediaKind, key: string): Promise<void>;
  exists(kind: MediaKind, key: string, variant: MediaVariant): Promise<boolean>;
  /**
   * Wolne i całkowite miejsce na wolumenie zdjęć (strażnik z 5.7). Może rzucić wyjątek; wywołujący
   * używa `checkFreeSpace`, który zamienia awarię odczytu na wstrzymanie (`space_unreadable`).
   */
  diskSpace(): Promise<DiskSpace>;
}
