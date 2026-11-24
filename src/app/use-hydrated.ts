import { useSyncExternalStore } from "react";

const noSubscription = () => () => undefined;

// False on the server and in the first render in the browser (hydration), true afterwards.
// A client button whose handler does nothing before hydration is `disabled` until then, so a
// tap on a slow phone is not lost without a sign (wzorzec jak w `CollectionsToDiscover`).
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
