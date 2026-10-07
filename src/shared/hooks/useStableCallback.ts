import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A callback whose identity never changes but always runs the latest render's function,
 * so memoized children are not re-rendered just because a parent recreated a handler.
 * Call it from events, not during render.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
) {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
