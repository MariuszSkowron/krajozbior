// A simple limit of searches running at once in this process (D-E12-10, m1 [P]): the scan has
// no index, so a burst of requests could take the whole connection pool. A request waits for
// a free place a short time; after that the caller says "busy" (never a server error).

export type SearchGate = Readonly<{
  /** Runs `work` when a place is free (waiting up to `waitMs`); `null` when it stayed busy. */
  run<T>(work: () => Promise<T>): Promise<T | null>;
  /** For tests: places in use and requests waiting. */
  state(): Readonly<{ active: number; waiting: number }>;
}>;

export function createSearchGate(maxConcurrent: number, waitMs: number): SearchGate {
  let active = 0;
  const waiting: (() => void)[] = [];

  function release(): void {
    const next = waiting.shift();

    if (next === undefined) {
      active -= 1;
    } else {
      next(); // the place passes on to the waiting request
    }
  }

  function acquire(): Promise<boolean> {
    if (active < maxConcurrent) {
      active += 1;

      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const grant = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const index = waiting.indexOf(grant);

        if (index >= 0) {
          waiting.splice(index, 1);
        }

        resolve(false);
      }, waitMs);

      waiting.push(grant);
    });
  }

  return {
    async run(work) {
      if (!(await acquire())) {
        return null;
      }

      try {
        return await work();
      } finally {
        release();
      }
    },
    state: () => ({ active, waiting: waiting.length }),
  };
}
