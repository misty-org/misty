// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  runtimeAiApi,
  useAgentAccountId,
  usePersonalAgentsStore,
  watchAllRunEvents,
  type MistyActivityEntry,
} from "@/features/agents";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { petSettingsEvent, petsApi } from "./petsApi";
import { derivePetStates, type PetStateSnapshot } from "./petState";

const DISPLAY_INTERVAL_MS = 1800;
const COMPLETION_DISPLAY_MS = 5400;

function snapshotSignature(snapshot: PetStateSnapshot): string {
  // The look direction belongs to the native cursor tracker, not to this.
  return [snapshot.sessionKey, snapshot.sessionName, snapshot.status, snapshot.activity].join(":");
}

function isWorkingStatus(status: PetStateSnapshot["status"]): boolean {
  return status === "running" || status === "waiting";
}

const IDLE_SNAPSHOT: PetStateSnapshot = {
  sessionKey: null,
  sessionName: null,
  status: "idle",
  lookDirection: 0,
  activity: "idle",
};

/**
 * Tells the pet what the person's agents are doing. Rendered once in a person's window; the pet
 * itself is its own window (`pet.html`). Nothing runs while the pet is off.
 */
export function PetRuntime() {
  const accountId = useAgentAccountId();
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    let petEnabled = false;
    let entries: MistyActivityEntry[] = [];
    let last = "";
    let displayedKey: string | null = null;
    let previous = new Map<string, PetStateSnapshot>();
    const completions = new Map<string, { snapshot: PetStateSnapshot; expiresAt: number }>();
    let refreshTimer: number | undefined;

    const publish = (rotate = false) => {
      if (disposed || !petEnabled) return;
      const now = Date.now();
      const current = derivePetStates(usePersonalAgentsStore.getState().agents, entries, now);
      const currentByKey = new Map(
        current
          .filter(
            (snapshot): snapshot is PetStateSnapshot & { sessionKey: string } =>
              snapshot.sessionKey !== null,
          )
          .map((snapshot) => [snapshot.sessionKey, snapshot]),
      );
      const newlyCompleted: string[] = [];
      for (const [key, before] of previous) {
        if (!currentByKey.has(key) && isWorkingStatus(before.status)) {
          completions.set(key, {
            snapshot: { ...before, status: "idle", activity: "completed" },
            expiresAt: now + COMPLETION_DISPLAY_MS,
          });
          newlyCompleted.push(key);
        }
      }
      for (const key of currentByKey.keys()) completions.delete(key);
      for (const [key, completion] of completions) {
        if (completion.expiresAt <= now) completions.delete(key);
      }
      const candidates = [...current, ...[...completions.values()].map(({ snapshot }) => snapshot)];
      const candidateKeys = new Set(candidates.map((snapshot) => snapshot.sessionKey));
      const changed = current.find((snapshot) => {
        const before = snapshot.sessionKey ? previous.get(snapshot.sessionKey) : undefined;
        return !before || snapshotSignature(before) !== snapshotSignature(snapshot);
      });
      const focusKey = newlyCompleted[0] ?? changed?.sessionKey ?? null;
      if (focusKey !== null && candidateKeys.has(focusKey)) {
        displayedKey = focusKey;
      } else if (rotate && candidates.length > 1) {
        const index = candidates.findIndex((snapshot) => snapshot.sessionKey === displayedKey);
        displayedKey = candidates[(index + 1) % candidates.length]?.sessionKey ?? null;
      } else if (!candidateKeys.has(displayedKey)) {
        displayedKey = candidates[0]?.sessionKey ?? null;
      }
      previous = new Map(currentByKey);
      const selected =
        candidates.find((snapshot) => snapshot.sessionKey === displayedKey) ?? IDLE_SNAPSHOT;
      const key = snapshotSignature(selected);
      if (key === last) return;
      last = key;
      void petsApi
        .setState({
          sessionKey: selected.sessionKey,
          sessionName: selected.sessionName,
          status: selected.status,
          activity: selected.activity,
          changedAt: Date.now(),
        })
        .catch(() => undefined);
    };

    const refresh = () =>
      void runtimeAiApi
        .activity("")
        .then((result) => {
          entries = result.entries;
          publish();
        })
        .catch(() => undefined);

    const reloadPetEnabled = () =>
      void petsApi
        .settings()
        .then((settings) => {
          const wasEnabled = petEnabled;
          petEnabled = settings.enabled && Boolean(settings.petId);
          if (petEnabled && !wasEnabled) {
            last = "";
            refresh();
          }
        })
        .catch(() => undefined);

    void usePersonalAgentsStore.getState().load(accountId);
    reloadPetEnabled();
    const unlistenSettings = listen(petSettingsEvent, reloadPetEnabled);
    // Runs report many times a second; the pet only needs to follow along.
    const stopWatching = watchAllRunEvents(() => {
      if (!petEnabled) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(refresh, 400);
    });
    const rotationTimer = window.setInterval(() => publish(true), DISPLAY_INTERVAL_MS);
    const unsubscribeAgents = usePersonalAgentsStore.subscribe(() => publish());
    return () => {
      disposed = true;
      window.clearTimeout(refreshTimer);
      window.clearInterval(rotationTimer);
      stopWatching();
      unsubscribeAgents();
      void unlistenSettings.then((dispose) => dispose());
    };
  }, [accountId]);
  return null;
}
