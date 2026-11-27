// A one-value, in-process cache with an expiry, for a public answer that is the same for everyone
// (the list behind "Pokaż najbliższe"). Concurrent reads of an empty or expired cache share one
// load; a failed load is not kept, so the next read tries again. The clock is injected.

export type SharedCache<T> = Readonly<{
  get(load: () => Promise<T>): Promise<T>;
}>;

export function createSharedCache<T>(options: {
  ttlMs: number;
  now: () => number;
}): SharedCache<T> {
  let stored: { value: T; expiresAt: number } | null = null;
  let loading: Promise<T> | null = null;

  return {
    get(load) {
      if (stored !== null && options.now() < stored.expiresAt) {
        return Promise.resolve(stored.value);
      }

      if (loading === null) {
        const started = (loading = load().then(
          (value) => {
            stored = { value, expiresAt: options.now() + options.ttlMs };
            loading = null;

            return value;
          },
          (error: unknown) => {
            loading = null;

            throw error;
          },
        ));

        return started;
      }

      return loading;
    },
  };
}
