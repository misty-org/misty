import { useEffect, useMemo, useState } from "react";
import { aiSurfaceApi, type AiSurfacePreferenceRecord, type AiUserSettings } from "./api";
import type { AiSuggestedAction, AiSurfaceAdapter } from "./types";

const proactiveDwellMs = 12_000;
const proactiveSnoozeMinutes = 24 * 60;

export interface ControlledProactiveSuggestion {
  action: AiSuggestedAction;
  reason: string;
  dismiss: () => Promise<void>;
  snooze: () => Promise<void>;
  reviewed: () => void;
}

export function useControlledProactivity(
  accountId: string,
  adapter: AiSurfaceAdapter | null,
): ControlledProactiveSuggestion | null {
  const proposedAction = adapter?.getSuggestedActions?.()[0];
  const actionId = proposedAction?.id ?? "";
  const actionLabel = proposedAction?.label ?? "";
  const actionPrompt = proposedAction?.prompt ?? "";
  const actionTrigger = proposedAction?.trigger;
  const actionArtifactKind = proposedAction?.requestedArtifactKind;
  const action = useMemo<AiSuggestedAction | undefined>(
    () =>
      actionId && actionLabel && actionPrompt
        ? {
            id: actionId,
            label: actionLabel,
            prompt: actionPrompt,
            trigger: actionTrigger,
            requestedArtifactKind: actionArtifactKind,
          }
        : undefined,
    [actionArtifactKind, actionId, actionLabel, actionPrompt, actionTrigger],
  );
  const surfaceId = adapter?.surfaceId ?? "";
  const [suggestion, setSuggestion] = useState<{
    action: AiSuggestedAction;
    reason: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let timer = 0;
    const load = async () => {
      setSuggestion(null);
      if (!accountId || !surfaceId || !action) return;
      const result = await aiSurfaceApi.settings().catch(() => null);
      if (!active || !result?.settings.enabled) return;
      const preference = result.preferences.find((item) => item.surface_id === surfaceId);
      if (!preference || !proactivePreferenceCanShow(result.settings, preference, Date.now())) {
        return;
      }
      timer = window.setTimeout(async () => {
        if (!active || document.visibilityState === "hidden") return;
        const recorded = await aiSurfaceApi
          .recordProactiveEvent(surfaceId, "shown")
          .catch(() => null);
        if (!active || !recorded) return;
        setSuggestion({
          action,
          reason: proactiveSuggestionReason(surfaceId),
        });
      }, proactiveDwellMs);
    };
    const refresh = () => void load();
    void load();
    window.addEventListener("misty:ai-preferences-changed", refresh);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("misty:ai-preferences-changed", refresh);
    };
  }, [accountId, action, actionId, surfaceId]);

  return useMemo(() => {
    if (!suggestion || !surfaceId) return null;
    return {
      ...suggestion,
      dismiss: async () => {
        setSuggestion(null);
        await aiSurfaceApi.recordProactiveEvent(surfaceId, "dismissed").catch(() => null);
      },
      snooze: async () => {
        setSuggestion(null);
        await aiSurfaceApi
          .recordProactiveEvent(surfaceId, "snoozed", proactiveSnoozeMinutes)
          .catch(() => null);
      },
      reviewed: () => setSuggestion(null),
    };
  }, [suggestion, surfaceId]);
}

export function proactivePreferenceCanShow(
  settings: Pick<AiUserSettings, "enabled">,
  preference: Pick<
    AiSurfacePreferenceRecord,
    | "proactive_enabled"
    | "proactive_cooldown_minutes"
    | "proactive_snoozed_until"
    | "proactive_last_shown_at"
  >,
  now: number,
) {
  if (!settings.enabled || !preference.proactive_enabled) return false;
  const snoozedUntil = Date.parse(preference.proactive_snoozed_until ?? "");
  if (Number.isFinite(snoozedUntil) && snoozedUntil > now) return false;
  const lastShownAt = Date.parse(preference.proactive_last_shown_at ?? "");
  const cooldown = Math.max(30, preference.proactive_cooldown_minutes || 360) * 60_000;
  return !Number.isFinite(lastShownAt) || lastShownAt + cooldown <= now;
}

export function proactiveSuggestionReason(surfaceId: string) {
  const label =
    {
      inbox: "Inbox",
      browser: "Browser",
      files: "Files",
      code: "Code",
      terminal: "Terminal",
      notes: "Notes",
      drawings: "Drawings",
      library: "Library",
      marketplace: "Store",
      transfers: "Transfers",
      "space.chat": "Space chat",
      "planner.tasks": "Tasks",
      "planner.agenda": "Agenda",
      "planner.roadmap": "Roadmaps",
    }[surfaceId] ?? "this tool";
  return `Because you enabled suggestions for ${label}. Nothing starts until you review it.`;
}
