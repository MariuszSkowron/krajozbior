import type { Actor } from "@/features/identity/domain/actor";

import { HOME_FAVORITES_LIMIT, HOME_RECENT_VISITS_LIMIT } from "../domain/home-album";
import type { Progress } from "../domain/progress";
import {
  HOME_REMAINING_NAMES,
  incompleteCollections,
  remainingCollections,
} from "../domain/home-return";
import type { AlbumDeps, AlbumOutcome, HomeAlbum, HomeReturn, HomeSummary } from "./album-types";

// The personal part of the home page (E12-1): the summary, the favourite
// collections and the latest visits of the signed-in explorer, in one
// transaction of the user context. Every query of the repository spells out the
// public filter itself (D-E12-1a), so a curator or an administrator sees here
// exactly what a guest could see of the collections and places; the limits (6, 5)
// are in the queries, not in the view. No user id is a parameter: the actor
// comes from the session.

function progressOf(visited: number, total: number): Progress {
  return total === 0 ? { kind: "empty" } : { kind: "progress", visited, total };
}

/**
 * Only the three counts of the home page, in one light query. Used where just the question
 * "has the account anything yet" is needed (the page chosen right after signing in).
 */
export async function getAlbumSummary(
  actor: Actor | null,
  deps: AlbumDeps,
): Promise<AlbumOutcome<HomeSummary>> {
  if (actor === null) {
    return { status: "unauthenticated" };
  }

  return deps.withUserContext(actor, async (tx) => ({
    status: "ok",
    value: await deps.repository.homeSummary(tx),
  }));
}

/**
 * "Powody do powrotu" of the home page: what is left in the saved collections and the started
 * collection that is not saved yet, in one transaction of the user context. Same rules as the
 * rest of the home album: the actor comes from the session, the public filter is in the SQL.
 */
export async function getHomeReturn(
  actor: Actor | null,
  deps: AlbumDeps,
): Promise<AlbumOutcome<HomeReturn>> {
  if (actor === null) {
    return { status: "unauthenticated" };
  }

  return deps.withUserContext(actor, async (tx) => {
    const favorites = (await deps.repository.homeFavorites(tx, HOME_FAVORITES_LIMIT)).map(
      ({ visited, total, ...collection }) => ({
        ...collection,
        progress: progressOf(visited, total),
      }),
    );
    const open = incompleteCollections(favorites);
    const unvisited =
      open.length === 0
        ? []
        : await deps.repository.homeUnvisitedPlaces(
            tx,
            open.map(({ id }) => id),
            HOME_REMAINING_NAMES,
          );
    const [saveNudge] = await deps.repository.homeStartedUnsaved(tx, 1);

    return {
      status: "ok",
      value: {
        hasSaved: favorites.length > 0,
        remaining: remainingCollections(favorites, unvisited),
        saveNudge: saveNudge ?? null,
      },
    } as const;
  });
}

export async function getHomeAlbum(
  actor: Actor | null,
  deps: AlbumDeps,
): Promise<AlbumOutcome<HomeAlbum>> {
  if (actor === null) {
    return { status: "unauthenticated" };
  }

  return deps.withUserContext(actor, async (tx) => {
    const summary = await deps.repository.homeSummary(tx);
    const favorites = await deps.repository.homeFavorites(tx, HOME_FAVORITES_LIMIT);
    const recentVisits = await deps.repository.homeRecentVisits(tx, HOME_RECENT_VISITS_LIMIT);

    return {
      status: "ok",
      value: {
        summary,
        favorites: favorites.map(({ visited, total, ...collection }) => ({
          ...collection,
          progress: progressOf(visited, total),
        })),
        recentVisits,
      },
    } as const;
  });
}
