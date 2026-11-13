import { useEffect } from "react";
import { usageLimits } from "./usageApi";

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The plan limits' saved copy on this computer, so a visit paints the last one at once. */
export const LIMITS_KEY = "engine-config/usage-limits";

export const loadLimits = (refresh: boolean) =>
  usageLimits({ refresh }).then((result) => result.providers);

/** Reports a block's load error in the page notice, beside what the block still shows. */
export function useReportError(error: unknown, onError: (error: string | null) => void) {
  useEffect(() => {
    if (error) onError(message(error));
  }, [error, onError]);
}

/** The app's shared clock, for reset countdowns. */
export { useNow } from "@/shared/hooks/useNow";
