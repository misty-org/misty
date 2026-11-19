import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { readDeckSnapshot, watchDeckSnapshot, type DeckSnapshot } from "../deck/snapshot";

const emptyDeck: DeckSnapshot = { title: "", theme: "misty", slides: [] };

/** The deck as plain data, current with the room; slides that didn't change keep their object. */
export function useDeckSnapshot(doc: Y.Doc | null | undefined): DeckSnapshot {
  const [snapshot, setSnapshot] = useState<DeckSnapshot>(() =>
    doc ? readDeckSnapshot(doc) : emptyDeck,
  );
  useEffect(() => {
    if (!doc) {
      setSnapshot(emptyDeck);
      return;
    }
    const watch = watchDeckSnapshot(doc, setSnapshot);
    setSnapshot(watch.current());
    return watch.stop;
  }, [doc]);
  return snapshot;
}
