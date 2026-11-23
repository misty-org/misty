import { useEffect } from "react";

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
