import type { PlaceCover } from "@/features/catalog/application/catalog-types";
import {
  collectionCoverLateral,
  coverCardColumns,
  coverCreditColumns,
  toCardCover,
  type CoverCardColumnsRow,
} from "@/features/catalog/infrastructure/collection-cover-sql";

import type { NewsReadRepository } from "../application/news-read-types";
import type { NewsKind } from "../domain/news";

// The guest reading of `news_posts` (E7-R3). The policy `news_posts_public_select` already
// limits a guest to published items of approved organizations; the conditions are repeated
// here so a change of the policy cannot open drafts by accident. Dates of events are cast to
// text (`YYYY-MM-DD`, no zone); the links to a collection and a place are returned only when
// they are public, with the same conditions as the catalog pages.
type CardRow = {
  slug: string;
  kind: NewsKind;
  title: string;
  lead: string;
  publishedAt: Date | string;
  eventStartsOn: string | null;
  eventEndsOn: string | null;
  organizationName: string;
  organizationSlug: string;
};

// The credit columns of the cover; the title of the photo is `photoTitle` (the item has a title).
type CreditRow = Omit<PlaceCover, "photoId" | "title"> & {
  photoId: string | null;
  photoTitle: string | null;
};

type ItemRow = CardRow &
  CreditRow & {
    body: string;
    contentUpdatedAt: Date | string | null;
    collectionSlug: string | null;
    collectionTitle: string | null;
    placeId: string | null;
    placeName: string | null;
  };

const cardColumns = `n.slug, n.kind, n.title, n.lead, n.published_at as "publishedAt",
  n.event_starts_on::text as "eventStartsOn", n.event_ends_on::text as "eventEndsOn",
  o.name as "organizationName", o.slug as "organizationSlug"`;

const published = `n.status = 'published' and o.status = 'approved'`;

// The public conditions of the links, in one place for the list and the item (T-2 of the spec
// "aktualności ze zdjęciami"): `c` is the linked collection only when it is published and its
// organization approved, `p` the linked place only when it lies in such a collection. The cover
// below reads `c.id` and `p.id`, never `n.collection_id` / `n.place_id`, so a draft or withdrawn
// collection and a place outside a public collection give no photo.
const publicLinkJoins = `left join public.collections c
           on c.id = n.collection_id
          and c.status = 'published'
          and exists (select from public.organizations co
                       where co.id = c.organization_id and co.status = 'approved')
         left join public.places p
           on p.id = n.place_id
          and exists (
            select
              from public.collection_places cp
              join public.collections pc on pc.id = cp.collection_id
              join public.organizations po on po.id = pc.organization_id
             where cp.place_id = p.id and pc.status = 'published' and po.status = 'approved'
          )`;

// The cover of a news item (T-1): the first ready photo of the linked public place (by position,
// the photo of the place page), else the cover of the linked public collection (the very lateral
// of the collection card: the curator's choice, else the first photo of the first place), else
// nothing. Columns are listed (never `ph.*`): the application role has no grant on the `hidden_*`
// columns, so hiding a photo is enforced by the policy `place_photos_select` of the guest context.
const newsCoverLateral = (alias: string) => `left join lateral (
      select u.id, u.width, u.height, u.alt_text, u.title, u.author_text, u.author_url,
             u.source_url, u.source_kind, u.license_code, u.license_url, u.license_label
        from (
          (select ph.id, ph.width, ph.height, ph.alt_text, ph.title, ph.author_text, ph.author_url,
                  ph.source_url, ph.source_kind, ph.license_code, ph.license_url, ph.license_label,
                  0 as k
             from public.place_photos ph
            where p.id is not null and ph.place_id = p.id
              and ph.file_state = 'ready' and ph.storage_key is not null
            order by ph.position
            limit 1)
          union all
          (select cc.id, cc.width, cc.height, cc.alt_text, cc.title, cc.author_text, cc.author_url,
                  cc.source_url, cc.source_kind, cc.license_code, cc.license_url, cc.license_label,
                  1 as k
             from (select 1) one
             ${collectionCoverLateral("cc")}
            where c.id is not null and cc.id is not null)
        ) u
       order by u.k
       limit 1
    ) ${alias} on true`;

function toCard(row: CardRow) {
  return {
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    lead: row.lead,
    publishedAt: new Date(row.publishedAt),
    eventStartsOn: row.eventStartsOn,
    eventEndsOn: row.eventEndsOn,
    organization: { name: row.organizationName, slug: row.organizationSlug },
  };
}

function toCreditCover(row: CreditRow): PlaceCover | null {
  return row.photoId === null
    ? null
    : {
        photoId: row.photoId,
        width: row.width,
        height: row.height,
        altText: row.altText,
        title: row.photoTitle,
        authorText: row.authorText,
        authorUrl: row.authorUrl,
        sourceUrl: row.sourceUrl,
        sourceKind: row.sourceKind,
        licenseCode: row.licenseCode,
        licenseUrl: row.licenseUrl,
        licenseLabel: row.licenseLabel,
      };
}

export const postgresNewsReadRepository: NewsReadRepository = {
  async listPublished(tx, kind, limit) {
    const rows = await tx.em.execute<(CardRow & CoverCardColumnsRow)[]>(
      `select ${cardColumns}, ${coverCardColumns("nc")}
         from public.news_posts n
         join public.organizations o on o.id = n.organization_id
         ${publicLinkJoins}
         ${newsCoverLateral("nc")}
        where ${published} ${kind === null ? "" : "and n.kind = ?"}
        order by n.published_at desc, n.id
        limit ?`,
      kind === null ? [limit] : [kind, limit],
    );

    return rows.map((row) => ({ ...toCard(row), cover: toCardCover(row) }));
  },

  async findPublished(tx, slug) {
    const rows = await tx.em.execute<ItemRow[]>(
      `select ${cardColumns}, n.body, n.content_updated_at as "contentUpdatedAt",
              c.slug as "collectionSlug", c.title as "collectionTitle",
              p.id as "placeId", p.name as "placeName", ${coverCreditColumns("nc", "photoTitle")}
         from public.news_posts n
         join public.organizations o on o.id = n.organization_id
         ${publicLinkJoins}
         ${newsCoverLateral("nc")}
        where ${published} and n.slug = ?`,
      [slug],
    );
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    return {
      ...toCard(row),
      body: row.body,
      contentUpdatedAt: row.contentUpdatedAt === null ? null : new Date(row.contentUpdatedAt),
      collection:
        row.collectionSlug === null || row.collectionTitle === null
          ? null
          : { slug: row.collectionSlug, title: row.collectionTitle },
      place:
        row.placeId === null || row.placeName === null
          ? null
          : { id: row.placeId, name: row.placeName },
      cover: toCreditCover(row),
    };
  },
};
