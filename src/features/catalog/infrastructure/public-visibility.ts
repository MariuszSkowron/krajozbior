// What "public" means in SQL (E12-1, D-E12-1a): one place for the catalog, the album and the
// search, so no feature depends on the infrastructure of another. Pure strings, no logic.

// "Published" is spelled out wherever a list is shown: the policies of a curator also show
// their own drafts, so a withdrawn collection must not appear in a public list.
// The collection is the row aliased `c`, its organization the row aliased `o`.
export const publishedCollection = `c.status = 'published' and o.status = 'approved'`;

// "The place lies in a public collection" (E12-1, D-E12-1a): spelled out wherever the home
// page shows data of a place, whatever the role of the actor. The place must also belong to
// an approved organization, as getPublishedPlace demands. The second condition is implied by
// the foreign key (collection_places.place_id, organization_id), so it is only a safeguard.
// RLS is the second barrier only: a curator's policies would show them more.
// The place is the row aliased `p`.
export const placeInPublicCollection = `
  exists (
    select
      from public.collection_places pcp
      join public.collections c on c.id = pcp.collection_id
      join public.organizations o on o.id = c.organization_id
     where pcp.place_id = p.id and ${publishedCollection}
  ) and exists (
    select from public.organizations po
     where po.id = p.organization_id and po.status = 'approved'
  )`;
