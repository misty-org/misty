import { useEffect } from "react";

/** Tells the page whether the composer holds an unsent draft or is still recording or
 * uploading, so leaving can ask first; both clear when the composer goes away. */
export function useDraftStatus(
  dirty: boolean,
  busy: boolean,
  onChange?: (status: { dirty: boolean; busy: boolean }) => void,
) {
  useEffect(() => {
    onChange?.({ dirty, busy });
    return () => onChange?.({ dirty: false, busy: false });
  }, [dirty, busy, onChange]);
}
