import { useEffect, useState } from "react";
import { codingAllowance, type CodingAllowance } from "./codingTools";

/**
 * Whether the account's plan includes coding (Pro and above), or null until it is known.
 * The server refuses coding for other plans either way; this only decides which controls show.
 */
export function useCodingIncluded(enabled = true): boolean | null {
  const [included, setIncluded] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const read = (allowance: CodingAllowance) => {
      if (live) setIncluded(allowance.coding ?? allowance.available);
    };
    codingAllowance({ onCached: read })
      .then(read)
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled]);
  return included;
}
