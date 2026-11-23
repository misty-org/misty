import { useEffect } from "react";
import { usageLimits } from "./usage_api";

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const LIMITS_KEY = "engine-config/usage-limits";

export const loadLimits = (refresh: boolean) =>
  usageLimits({ refresh }).then((result) => result.providers);

export function useReportError(error: unknown, onError: (error: string | null) => void) {
  useEffect(() => {
    if (error) onError(message(error));
  }, [error, onError]);
}

export { useNow } from "@/shared/hooks/use_now";
