import { useCallback, useState } from "react";
import { samePlace, type FilesPlace } from "./model";

type History = { places: FilesPlace[]; at: number };

/** Back and Forward over the places Files went to, as a browser's history works. */
export function useNavigation(start: FilesPlace) {
  const [history, setHistory] = useState<History>({ places: [start], at: 0 });
  const place = history.places[history.at];

  /** Goes to a place; `replace` swaps the current one instead (the columns' clicks). */
  const go = useCallback((next: FilesPlace, replace = false) => {
    setHistory((now) => {
      const here = now.places[now.at];
      if (samePlace(here, next)) return now;
      if (replace) {
        const places = [...now.places];
        places[now.at] = next;
        return { places, at: now.at };
      }
      return { places: [...now.places.slice(0, now.at + 1), next], at: now.at + 1 };
    });
  }, []);
  const back = useCallback(
    () => setHistory((now) => (now.at > 0 ? { ...now, at: now.at - 1 } : now)),
    [],
  );
  const forward = useCallback(
    () => setHistory((now) => (now.at < now.places.length - 1 ? { ...now, at: now.at + 1 } : now)),
    [],
  );
  return {
    place,
    go,
    back,
    forward,
    canBack: history.at > 0,
    canForward: history.at < history.places.length - 1,
  };
}
