import { useCallback, useEffect, useRef, useState } from "react";

const defaultMinimumSpinMs = 650;

export function useMinimumSpin(
  active = false,
  minimumMs = defaultMinimumSpinMs,
): readonly [boolean, () => void] {
  const [localSpinning, setLocalSpinning] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const clearSpinTimeout = useCallback(() => {
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const startSpin = useCallback(() => {
    clearSpinTimeout();
    setLocalSpinning(true);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setLocalSpinning(false);
    }, minimumMs);
  }, [clearSpinTimeout, minimumMs]);

  useEffect(() => {
    if (active) startSpin();
  }, [active, startSpin]);

  useEffect(() => clearSpinTimeout, [clearSpinTimeout]);

  return [active || localSpinning, startSpin] as const;
}
