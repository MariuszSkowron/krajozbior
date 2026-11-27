// The cover of a collection in SQL (D-55 pkt 1, D-57), in one place for the catalog and the news
// (T-4 of the spec "aktualności ze zdjęciami"): the lateral that picks the photo, the columns of
// a card thumbnail, the columns of a cover with its credit and the mapping of a card row. News
// import this file, so the cover of a news item cannot drift from the cover of the collection.
// Pure strings and one pure mapper, no database access.

import type { CollectionCover } from "../application/catalog-types";

// The cover is joined in the context of the list (the guest), so the policy of `place_photos`
// leaves the photo only when everyone may see it (ready, not hidden, in a public collection);
// the conditions are repeated for the reader of the query. No cover or a photo nobody may see
// gives nulls: the card keeps the placeholder.
//
// The collection is the row aliased `c` and the lateral does NOT check its status: the caller's
// join must carry the conditions of a public collection (published, approved organization).
//
// The automatic cover (D-55 pkt 1, D-57): the photo chosen by the curator when it is ready,
// otherwise the first ready photo of the first place (by position in the collection) that has
// one. Both are only photos of the collection's own places. The columns are listed (never
// `ph.*`): the application role has no grant on the `hidden_*` columns.
//
// Two branches joined with `union all` (the chosen photo by its key, the places of the collection
// by `collection_places`, then the first ready photo of each place through the index
// `(place_id, position)`), so no branch scans the whole table of photos: the sort key `k` puts
// the chosen photo first.
export const collectionCoverLateral = (alias: string) => `left join lateral (
      select u.id, u.place_id, u.width, u.height, u.alt_text, u.title, u.author_text, u.author_url,
             u.source_url, u.source_kind, u.license_code, u.license_url, u.license_label
        from (
          (select ph.id, ph.place_id, ph.width, ph.height, ph.alt_text, ph.title, ph.author_text, ph.author_url,
                  ph.source_url, ph.source_kind, ph.license_code, ph.license_url, ph.license_label,
                  0 as k, 0 as place_pos, ph.position as photo_pos
             from public.place_photos ph
            where ph.id = c.cover_place_photo_id
              and ph.file_state = 'ready' and ph.storage_key is not null)
          union all
          (select ph.id, ph.place_id, ph.width, ph.height, ph.alt_text, ph.title, ph.author_text, ph.author_url,
                  ph.source_url, ph.source_kind, ph.license_code, ph.license_url, ph.license_label,
                  1 as k, cp.position as place_pos, ph.position as photo_pos
             from public.collection_places cp
             cross join lateral (
               select p.id, p.place_id, p.width, p.height, p.alt_text, p.title, p.author_text, p.author_url,
                      p.source_url, p.source_kind, p.license_code, p.license_url, p.license_label,
                      p.position
                 from public.place_photos p
                where p.place_id = cp.place_id
                  and p.file_state = 'ready' and p.storage_key is not null
                order by p.position
                limit 1
             ) ph
            where cp.collection_id = c.id)
        ) u
       order by u.k, u.place_pos, u.photo_pos
       limit 1
    ) ${alias} on true`;

/** Columns of a card thumbnail: id, size and description of the cover photo, never the credit. */
export const coverCardColumns = (alias: string) =>
  `${alias}.id as "coverPhotoId", ${alias}.width as "coverWidth", ${alias}.height as "coverHeight",
  ${alias}.alt_text as "coverAltText"`;

/** Columns of a cover with what its credit needs (the page of a collection, the banner, a news item). */
export const coverCreditColumns = (alias: string, titleAs = "title") =>
  `${alias}.id as "photoId", ${alias}.width, ${alias}.height, ${alias}.alt_text as "altText", ${alias}.title as "${titleAs}",
  ${alias}.author_text as "authorText", ${alias}.author_url as "authorUrl",
  ${alias}.source_url as "sourceUrl", ${alias}.source_kind as "sourceKind",
  ${alias}.license_code as "licenseCode", ${alias}.license_url as "licenseUrl",
  ${alias}.license_label as "licenseLabel"`;

export type CoverCardColumnsRow = {
  coverPhotoId: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  coverAltText: string | null;
};

/** The thumbnail of a card from the columns `coverCardColumns`; `null` when there is no photo. */
export function toCardCover(row: CoverCardColumnsRow): CollectionCover | null {
  const { coverPhotoId, coverWidth, coverHeight, coverAltText } = row;

  return coverPhotoId === null ||
    coverWidth === null ||
    coverHeight === null ||
    coverAltText === null
    ? null
    : { photoId: coverPhotoId, width: coverWidth, height: coverHeight, altText: coverAltText };
}
