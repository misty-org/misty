import { useEffect, useState } from "react";

const TYPE_MS = 125;
const DELETE_MS = 55;
const HOLD_MS = 3000;

/**
 * Types each phrase in, holds, deletes, and moves to the next. When disabled it
 * rests on the first phrase, fully typed — the CSS reduced-motion rule in
 * index.css cannot stop a JS timer, so that case is handled here instead.
 */
export function useTypedPhrase(phrases: readonly string[], enabled: boolean) {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(phrases[0].length);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const phrase = phrases[index];
    const settled = !deleting && length === phrase.length;
    const timer = window.setTimeout(
      () => {
        if (deleting) {
          if (length === 0) {
            setDeleting(false);
            setIndex((current) => (current + 1) % phrases.length);
          } else {
            setLength(length - 1);
          }
        } else if (settled) {
          setDeleting(true);
        } else {
          setLength(length + 1);
        }
      },
      settled ? HOLD_MS : deleting ? DELETE_MS : TYPE_MS,
    );

    return () => window.clearTimeout(timer);
  }, [enabled, phrases, index, length, deleting]);

  return phrases[index].slice(0, length);
}
