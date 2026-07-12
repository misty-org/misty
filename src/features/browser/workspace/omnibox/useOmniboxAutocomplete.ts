import { useEffect, useMemo, useState } from "react";
import { mergeMatches, stillMatches } from "./controller";
import type { OmniboxInput, OmniboxMatch, OmniboxProvider } from "./types";

type ProviderResults = Record<string, OmniboxMatch[]>;

/**
 * Runs every provider for the current input and returns the merged list.
 * Synchronous providers show on the same frame; slower ones slot in as they
 * resolve. A new keystroke cancels in-flight work, and earlier rows that
 * still fit the new text stay until fresh ones replace them, so the list
 * does not flicker empty between keystrokes. `input` must be memoized.
 */
export function useOmniboxAutocomplete(
  input: OmniboxInput | null,
  providers: readonly OmniboxProvider[],
): OmniboxMatch[] {
  const [results, setResults] = useState<ProviderResults>({});

  useEffect(() => {
    if (!input) {
      setResults({});
      return;
    }
    const controller = new AbortController();
    const ready: ProviderResults = {};
    const pending: [string, Promise<OmniboxMatch[]>][] = [];
    for (const provider of providers) {
      try {
        const result = provider.start(input, controller.signal);
        if (Array.isArray(result)) ready[provider.id] = result;
        else pending.push([provider.id, result]);
      } catch {
        ready[provider.id] = [];
      }
    }
    setResults((previous) => {
      const next = { ...ready };
      for (const [id] of pending)
        next[id] = (previous[id] ?? []).filter((match) => stillMatches(match, input.text));
      return next;
    });
    for (const [id, promise] of pending) {
      promise.then(
        (matches) => {
          if (!controller.signal.aborted) setResults((previous) => ({ ...previous, [id]: matches }));
        },
        () => undefined,
      );
    }
    return () => controller.abort();
  }, [input, providers]);

  return useMemo(() => mergeMatches(Object.values(results)), [results]);
}
