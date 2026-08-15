import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface SpaceAgendaVisibility {
  tasks: boolean;
  roadmap: boolean;
  hiddenSources: string[];
}

const defaults: SpaceAgendaVisibility = { tasks: true, roadmap: true, hiddenSources: [] };

export function useSpaceAgendaPreferences(accountId: string, spaceId: string) {
  const baseKey = useMemo(
    () => `misty:agenda-visibility:${accountId || "anonymous"}:${spaceId}`,
    [accountId, spaceId],
  );
  const key = useMemo(
    () => deploymentStorageKey(baseKey),
    [baseKey],
  );
  const [visibility, setVisibilityState] = useState<SpaceAgendaVisibility>(() => read(baseKey));

  useEffect(() => {
    setVisibilityState(read(baseKey));
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: SpaceAgendaVisibility }>).detail;
      if (detail?.key === key && detail.value) setVisibilityState(detail.value);
    };
    window.addEventListener("misty:agenda-visibility", handleChange);
    return () => window.removeEventListener("misty:agenda-visibility", handleChange);
  }, [baseKey, key]);

  const setVisibility = useCallback(
    (next: SpaceAgendaVisibility | ((current: SpaceAgendaVisibility) => SpaceAgendaVisibility)) => {
      setVisibilityState((current) => {
        const value = typeof next === "function" ? next(current) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(value));
        } catch {
          // Preferences remain usable for the current session when storage is unavailable.
        }
        window.dispatchEvent(
          new CustomEvent("misty:agenda-visibility", { detail: { key, value } }),
        );
        return value;
      });
    },
    [key],
  );

  return { visibility, setVisibility };
}

function read(key: string): SpaceAgendaVisibility {
  try {
    const value = JSON.parse(readDeploymentStorageItem(key) ?? "null") as Partial<SpaceAgendaVisibility> | null;
    return {
      tasks: value?.tasks !== false,
      roadmap: value?.roadmap !== false,
      hiddenSources: Array.isArray(value?.hiddenSources) ? value.hiddenSources : [],
    };
  } catch {
    return defaults;
  }
}
