import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Abuse limit of the explorer's album writes (saving and unsaving a
// collection), counted per user. A starting value, changeable without a
// decision of the owner.
export const ALBUM_WRITE_ACTION = "album_write";
export const albumWriteLimit: ActionLimit = { limit: 120, windowSeconds: 10 * 60 };
