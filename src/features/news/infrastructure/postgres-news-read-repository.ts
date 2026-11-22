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

type ItemRow = CardRow & {
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

export const postgresNewsReadRepository: NewsReadRepository = {
  async listPublished(tx, kind, limit) {
    const rows = await tx.em.execute<CardRow[]>(
      `select ${cardColumns}
         from public.news_posts n
         join public.organizations o on o.id = n.organization_id
        where ${published} ${kind === null ? "" : "and n.kind = ?"}
        order by n.published_at desc, n.id
        limit ?`,
      kind === null ? [limit] : [kind, limit],
    );

    return rows.map(toCard);
  },

  async findPublished(tx, slug) {
    const rows = await tx.em.execute<ItemRow[]>(
      `select ${cardColumns}, n.body, n.content_updated_at as "contentUpdatedAt",
              c.slug as "collectionSlug", c.title as "collectionTitle",
              p.id as "placeId", p.name as "placeName"
         from public.news_posts n
         join public.organizations o on o.id = n.organization_id
         left join public.collections c
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
          )
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
    };
  },
};
