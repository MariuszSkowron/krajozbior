import { Migration } from "@mikro-orm/migrations";

// E4-2a: oficjalne zdjęcia miejsc, na razie tylko ścieżka Commons (specyfikacja E4, 5.1 z
// „Uzupełnieniem 2026-11-21” i 5.11.3).
//
// `place_photos`: klasa Publiczna, gdy miejsce jest w opublikowanej kolekcji zatwierdzonej
// organizacji i zdjęcie jest gotowe oraz nieukryte; inaczej CUR (jak `places`).
//
// Uprawnienia na tym etapie są węższe niż docelowe (E4-1 je rozszerza osobną migracją):
// - `krajozbior_app` (kurator `full_edit`): INSERT wyłącznie wiersza `commons_import` w stanie
//   `pending_fetch` bez pliku (restrykcyjna polityka), UPDATE kolumn podpisu i pozycji, DELETE.
//   Nie ustawi `file_state`, `storage_key`, `width`, `height`, `content_sha256` ani `fetch_attempts`.
// - `krajozbior_ops` (`photos:fetch`): odczyt kolumn potrzebnych do pobrania, UPDATE kolumn pliku
//   tylko w wierszach `commons_import`.
// - Bez grantu dla aplikacji: `created_by`, `hidden_*`, `rights_*`, `content_sha256`, `commons_file`,
//   `retrieved_at`, `fetch_attempts`, `created_at`, `updated_at`.
//
// Dodatkowo:
// - `source_width` (szerokość oryginału z pliku kolekcji): przy `pending_fetch` tabela nie zna
//   wymiarów, a polecenie pobierania musi wybrać szerokość miniatury (uzupełnienie specyfikacji).
// - `catalog_import_keys` przyjmuje rodzaj `photo` (klucz zdjęcia zapamiętuje wgranie).
// - `operations_audit`: operacja `photos_fetch` i kod błędu `photos_fetch_failed`; `details` także
//   dla `photos_fetch` (same liczby).
// - `ops_media_keys()`: klucze plików do porządkowania (polecenie `photos:sweep`, osobna faza).

const licenseCodes = [
  "cc0-1.0",
  "public-domain",
  "cc-by-2.0",
  "cc-by-2.5",
  "cc-by-3.0",
  "cc-by-4.0",
  "cc-by-sa-2.0",
  "cc-by-sa-2.5",
  "cc-by-sa-3.0",
  "cc-by-sa-4.0",
  "krajozbior_org_license",
];
const licenseCodeList = licenseCodes.map((code) => `'${code}'`).join(", ");

// Adres licencji w postaci kanonicznej, zgodny z kodem (A-S3). Kraj (dwie litery) tylko dla 2.0–3.0.
function licenseUrlCheck(): string {
  const cases: string[] = [
    `(license_code = 'krajozbior_org_license' and license_url is null)`,
    `(license_code = 'cc0-1.0' and license_url = 'https://creativecommons.org/publicdomain/zero/1.0/')`,
    `(license_code = 'public-domain' and license_url = 'https://creativecommons.org/publicdomain/mark/1.0/')`,
  ];

  for (const family of ["by", "by-sa"]) {
    for (const version of ["2.0", "2.5", "3.0", "4.0"]) {
      const country = version === "4.0" ? "" : "([a-z]{2}/)?";
      const escaped = version.replace(".", "\\.");

      cases.push(
        `(license_code = 'cc-${family}-${version}' and license_url ~ '^https://creativecommons\\.org/licenses/${family}/${escaped}/${country}$')`,
      );
    }
  }

  return cases.join("\n          or ");
}

const previousOperations = `'grant_curator', 'revoke_curator', 'set_organization_status', 'set_user_role', 'delete_account', 'catalog_import', 'catalog_remove'`;
const operations = `${previousOperations}, 'photos_fetch'`;
const previousErrorCodes = `'user_not_found', 'organization_not_found', 'kind_mismatch', 'person_member_limit', 'organization_details_required', 'import_refused', 'import_failed'`;
const errorCodes = `${previousErrorCodes}, 'photos_fetch_failed'`;

const publicCollection = `
  exists (
    select
      from public.collection_places cp
      join public.collections pc on pc.id = cp.collection_id
      join public.organizations po on po.id = pc.organization_id
     where cp.place_id = place_photos.place_id
       and pc.status = 'published'
       and po.status = 'approved'
  )`;

export class Migration20261121170000_place_photos extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table place_photos (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null,
        place_id uuid not null,
        position integer not null check (position >= 1),
        file_state text not null check (file_state in ('ready', 'pending_fetch', 'fetch_failed')),
        storage_key uuid null unique,
        width integer null check (width between 1 and 100000),
        height integer null check (height between 1 and 100000),
        content_sha256 bytea null check (octet_length(content_sha256) = 32),
        alt_text text not null
          check (char_length(alt_text) between 1 and 200 and alt_text !~ '[[:cntrl:]]'),
        source_kind text not null check (source_kind in ('own', 'third_party', 'commons_import')),
        title text null check (char_length(title) between 1 and 300),
        author_text text not null check (char_length(author_text) between 1 and 300),
        author_url text null check (author_url ~ '^https://' and char_length(author_url) <= 500),
        source_url text null check (source_url ~ '^https://' and char_length(source_url) <= 500),
        license_code text not null check (license_code in (${licenseCodeList})),
        license_url text null,
        license_label text not null check (char_length(license_label) between 1 and 40),
        fetch_attempts smallint not null default 0 check (fetch_attempts between 0 and 100),
        rights_statement text not null check (char_length(rights_statement) between 1 and 40),
        rights_confirmed_at timestamptz not null default now(),
        created_by uuid null default app_current_user_id() references auth.users (id) on delete set null,
        commons_file text null check (char_length(commons_file) between 1 and 300),
        source_width integer null check (source_width between 1 and 100000),
        retrieved_at timestamptz null,
        hidden_at timestamptz null,
        hidden_reason text null check (char_length(hidden_reason) <= 400),
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        foreign key (place_id, organization_id)
          references places (id, organization_id) on delete cascade,
        unique (place_id, position) deferrable initially deferred,
        unique (place_id, content_sha256),
        unique (place_id, commons_file),
        constraint place_photos_ready_check
          check (file_state <> 'ready' or (storage_key is not null and width is not null and height is not null)),
        constraint place_photos_commons_check
          check (source_kind <> 'commons_import' or (commons_file is not null and source_url is not null)),
        constraint place_photos_hidden_check
          check (hidden_reason is null or hidden_at is not null),
        constraint place_photos_license_url_check
          check (
          ${licenseUrlCheck()}
          )
      );
    `);
    this.addSql(`create index place_photos_organization_id_idx on place_photos (organization_id);`);
    this.addSql(`create index place_photos_place_id_idx on place_photos (place_id, position);`);
    this.addSql(
      `create index place_photos_pending_idx on place_photos (created_at) where source_kind = 'commons_import' and file_state in ('pending_fetch', 'fetch_failed');`,
    );

    this.addSql(`alter table place_photos enable row level security;`);
    // FORCE: właściciel tabeli też podlega politykom.
    this.addSql(`alter table place_photos force row level security;`);
    this.addSql(
      `revoke all on place_photos from public, krajozbior_app, krajozbior_auth, krajozbior_ops;`,
    );

    // Aplikacja: odczyt tylko kolumn do wyświetlenia (bez `commons_file`, `content_sha256`,
    // `hidden_*`, `created_by`, `rights_*`, `retrieved_at`, `fetch_attempts`).
    this.addSql(`
      grant select (id, organization_id, place_id, position, file_state, storage_key, width, height,
                    alt_text, source_kind, title, author_text, author_url, source_url, license_code,
                    license_url, license_label, source_width, version)
        on place_photos to krajozbior_app;
    `);
    this.addSql(`
      grant insert (organization_id, place_id, position, file_state, storage_key, width, height,
                    content_sha256, alt_text, source_kind, title, author_text, author_url, source_url,
                    license_code, license_url, license_label, rights_statement, commons_file,
                    source_width, retrieved_at)
        on place_photos to krajozbior_app;
    `);
    this.addSql(`
      grant update (position, alt_text, title, author_text, author_url, source_url, license_code,
                    license_url, license_label, source_width, version, updated_at)
        on place_photos to krajozbior_app;
    `);
    this.addSql(`grant delete on place_photos to krajozbior_app;`);

    this.addSql(`
      create policy place_photos_select on place_photos for select to krajozbior_app
        using (
          app_org_permission(organization_id) is not null
          or (hidden_at is null and file_state = 'ready' and ${publicCollection})
        );
    `);
    this.addSql(`
      create policy place_photos_insert on place_photos for insert to krajozbior_app
        with check (app_org_permission(organization_id) = 'full_edit');
    `);
    // Do E4-1: aplikacja wstawia wyłącznie wiersz z importu, jeszcze bez pliku.
    this.addSql(`
      create policy place_photos_insert_commons_only on place_photos
        as restrictive for insert to krajozbior_app
        with check (
          source_kind = 'commons_import' and file_state = 'pending_fetch'
          and storage_key is null and width is null and height is null and content_sha256 is null
        );
    `);
    this.addSql(`
      create policy place_photos_update on place_photos for update to krajozbior_app
        using (app_org_permission(organization_id) = 'full_edit')
        with check (app_org_permission(organization_id) = 'full_edit');
    `);
    this.addSql(`
      create policy place_photos_delete on place_photos for delete to krajozbior_app
        using (app_org_permission(organization_id) = 'full_edit');
    `);

    // `krajozbior_ops`: pobieranie plików z Commons.
    this.addSql(`
      grant select (id, place_id, organization_id, source_kind, file_state, storage_key,
                    commons_file, width, height, source_width, fetch_attempts, created_at)
        on place_photos to krajozbior_ops;
    `);
    this.addSql(`
      grant update (file_state, storage_key, width, height, content_sha256, fetch_attempts, updated_at)
        on place_photos to krajozbior_ops;
    `);
    this.addSql(`
      create policy place_photos_ops_select on place_photos for select to krajozbior_ops
        using (true);
    `);
    this.addSql(`
      create policy place_photos_ops_update on place_photos for update to krajozbior_ops
        using (source_kind = 'commons_import')
        with check (source_kind = 'commons_import');
    `);

    // Funkcja `security definer` czyta tabelę z FORCE, więc właściciel dostaje wąską politykę.
    this.addSql(`
      create policy place_photos_owner_media_keys on place_photos for select to krajozbior_owner
        using (storage_key is not null);
    `);
    this.addSql(`
      create function ops_media_keys() returns table (media_kind text, storage_key uuid)
      language sql stable security definer
      set search_path = ''
      as $$
        select 'p'::text, ph.storage_key from public.place_photos ph where ph.storage_key is not null
      $$;
    `);
    this.addSql(`revoke all on function ops_media_keys() from public;`);
    this.addSql(`grant execute on function ops_media_keys() to krajozbior_ops;`);

    // Klucz importu zdjęcia w tabeli kluczy wgrywania.
    this.addSql(
      `alter table catalog_import_keys drop constraint catalog_import_keys_entity_kind_check;`,
    );
    this.addSql(`
      alter table catalog_import_keys add constraint catalog_import_keys_entity_kind_check
        check (entity_kind in ('collection', 'place', 'photo'));
    `);

    // Dziennik operacji: `photos_fetch`.
    this.addSql(`alter table operations_audit drop constraint operations_audit_operation_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_operation_check
        check (operation in (${operations}));
    `);
    this.addSql(`alter table operations_audit drop constraint operations_audit_error_code_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_error_code_check
        check (error_code in (${errorCodes}));
    `);
    this.addSql(`alter table operations_audit drop constraint operations_audit_details_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_details_check
        check (
          details is null
          or (
            jsonb_typeof(details) = 'object'
            and operation in ('catalog_import', 'catalog_remove', 'photos_fetch')
            and char_length(details::text) <= 4000
          )
        );
    `);
  }

  override async down(): Promise<void> {
    // Wpisy dziennika są tylko do dopisywania, więc poprzednie ograniczenia wracają jako NOT VALID
    // (jak w Migration20261121140000).
    this.addSql(`alter table operations_audit drop constraint operations_audit_details_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_details_check
        check (
          details is null
          or (
            jsonb_typeof(details) = 'object'
            and operation in ('catalog_import', 'catalog_remove')
            and char_length(details::text) <= 4000
          )
        ) not valid;
    `);
    this.addSql(`alter table operations_audit drop constraint operations_audit_error_code_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_error_code_check
        check (error_code in (${previousErrorCodes})) not valid;
    `);
    this.addSql(`alter table operations_audit drop constraint operations_audit_operation_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_operation_check
        check (operation in (${previousOperations})) not valid;
    `);

    this.addSql(
      `alter table catalog_import_keys drop constraint catalog_import_keys_entity_kind_check;`,
    );
    this.addSql(`
      alter table catalog_import_keys add constraint catalog_import_keys_entity_kind_check
        check (entity_kind in ('collection', 'place')) not valid;
    `);

    this.addSql(`drop function ops_media_keys();`);
    this.addSql(`drop table place_photos;`);
  }
}
