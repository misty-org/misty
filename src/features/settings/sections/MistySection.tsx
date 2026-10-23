import { useAuth } from "@/features/auth";
import { SystemErrorNotice } from "@/features/support/systemErrors";
import { publicBetaFeatureEnabled } from "@/features/launch";
import {
  aiSurfaceApi,
  type AiMemoryRecord,
  type AiRecapRecord,
  type AiSurfacePreferenceRecord,
  type AiUserSettings,
} from "@/features/ai-surface/api";
import { useAiSurfaceStore } from "@/features/ai-surface/store";
import type { AiSurfaceId } from "@/features/ai-surface/types";
import { confirmAction } from "@/shared/lib/confirmAction";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { ChoiceControl, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { MistyBriefingsSection } from "./MistyBriefingsSection";
import { MistyRememberedSection } from "./MistyRememberedSection";
import { defaultRecap, managedSurfaces } from "./mistySettingsConfig";

export function MistySection(_props: SettingsContentProps & { page?: "misty" | "memory" }) {
  const memoryPage = _props.page === "memory";
  const { user } = useAuth();
  const [settings, setSettings] = useState<AiUserSettings | null>(null);
  const [preferences, setPreferences] = useState<Record<string, AiSurfacePreferenceRecord>>({});
  const [recaps, setRecaps] = useState<Record<string, AiRecapRecord>>({});
  const [memories, setMemories] = useState<AiMemoryRecord[]>([]);
  const [recapSurface, setRecapSurface] = useState<AiRecapRecord["surface_id"]>("activity");
  const [recapDraft, setRecapDraft] = useState<AiRecapRecord>(() => defaultRecap("activity"));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void aiSurfaceApi
      .settings()
      .then((result) => {
        if (!active) return;
        setSettings(result.settings);
        setPreferences(
          Object.fromEntries(result.preferences.map((item) => [item.surface_id, item])),
        );
      })
      .catch(() => active && setError("Misty settings could not load."));
    void aiSurfaceApi
      .memories()
      .then((result) => active && setMemories(result.memories))
      .catch(() => undefined);
    if (publicBetaFeatureEnabled("recurringBriefings")) {
      void aiSurfaceApi
        .recaps()
        .then((result) => {
          if (!active) return;
          const values = Object.fromEntries(result.recaps.map((item) => [item.surface_id, item]));
          setRecaps(values);
          setRecapDraft(values.activity ?? defaultRecap("activity"));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setRecapDraft(recaps[recapSurface] ?? defaultRecap(recapSurface));
  }, [recapSurface, recaps]);

  const updateSettings = async (
    enabled: boolean,
    retentionDays = settings?.retention_days ?? 30,
    memoryEnabled = settings?.memory_enabled ?? true,
  ) => {
    if (!settings || working) return;
    if (
      !enabled &&
      !(await confirmAction(
        "Turn off Misty everywhere? New AI work will stop immediately. Unaccepted drafts, personal AI preferences, " +
          "private embeddings, and generated metadata will be purged. Accepted work and required audit records remain.",
        "Turn off Misty",
      ))
    ) {
      return;
    }
    setWorking(true);
    setError("");
    try {
      const result = await aiSurfaceApi.updateSettings(enabled, retentionDays, memoryEnabled);
      setSettings(result.settings);
      if (!enabled && user?.id) useAiSurfaceStore.getState().clearAccount(user.id);
    } catch {
      setError("Misty settings could not be saved. Try again.");
    } finally {
      setWorking(false);
    }
  };

  const forgetMemory = async (memoryId: string) => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await aiSurfaceApi.forgetMemory(memoryId);
      setMemories((items) => items.filter((item) => item.id !== memoryId));
    } catch {
      setError("That memory could not be forgotten. Try again.");
    } finally {
      setWorking(false);
    }
  };

  const updatePreference = async (
    surfaceId: AiSurfaceId,
    patch: Partial<AiSurfacePreferenceRecord>,
  ) => {
    const current = preferences[surfaceId] ?? {
      surface_id: surfaceId,
      proactive_enabled: false,
      saved_actions: [],
    };
    setWorking(true);
    try {
      const result = await aiSurfaceApi.updatePreference(surfaceId, {
        proactive_enabled: patch.proactive_enabled ?? current.proactive_enabled,
        saved_actions: patch.saved_actions ?? current.saved_actions,
      });
      setPreferences((values) => ({ ...values, [surfaceId]: result.preference }));
      window.dispatchEvent(new Event("misty:ai-preferences-changed"));
    } catch {
      setError("The surface preference could not be saved. Try again.");
    } finally {
      setWorking(false);
    }
  };

  const saveRecap = async () => {
    if (working || settings?.enabled === false) return;
    setWorking(true);
    setError("");
    try {
      const result = await aiSurfaceApi.updateRecap(recapSurface, {
        enabled: recapDraft.enabled,
        cadence: recapDraft.cadence,
        local_time: recapDraft.local_time,
        weekday: recapDraft.weekday,
        timezone: recapDraft.timezone,
        prompt: recapDraft.prompt,
      });
      setRecaps((values) => ({ ...values, [recapSurface]: result.recap }));
    } catch {
      setError("The recurring briefing could not be saved. Try again.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      {!memoryPage && (
        <SettingsSectionBlock
          title="Misty everywhere"
          description="Misty is the built-in contextual copilot. Agents remains the destination for durable conversations, configuration, and delegated work."
        >
          <SettingsRow
            label="Enable Misty"
            description="Allow hosted AI in the Misty panel and across your workspace. Search keeps working when this is off."
          >
            <SwitchControl
              checked={settings?.enabled ?? false}
              disabled={!settings || working}
              onChange={(value) => void updateSettings(value)}
            />
          </SettingsRow>
          <SettingsRow
            label="Conversation retention"
            description="Accepted work and required security audits follow their domain retention rules."
            muted={!settings || !settings.enabled}
          >
            <ChoiceControl
              value={String(settings?.retention_days ?? 30)}
              disabled={!settings || working || !settings.enabled}
              onValueChange={(value) => void updateSettings(true, Number(value))}
              options={[7, 30, 90, 365].map((days) => ({
                value: String(days),
                label: `${days} days`,
              }))}
            />
          </SettingsRow>
        </SettingsSectionBlock>
      )}

      {memoryPage && (
        <>
          <MistyRememberedSection
            settings={settings}
            working={working}
            memories={memories}
            onMemoryEnabledChange={(value) =>
              void updateSettings(true, settings?.retention_days ?? 30, value)
            }
            onForget={(memoryId) => void forgetMemory(memoryId)}
          />
        </>
      )}
      {!memoryPage && (
        <SettingsSectionBlock
          title="Per-surface behavior"
          description={
            "Proactive suggestions are off by default. When enabled, a quiet nudge explains " +
            "why it appeared, respects cooldowns and snooze, and never starts work until you review it."
          }
        >
          {managedSurfaces.map((surface) => {
            const preference = preferences[surface.id];
            return (
              <SettingsRow
                key={surface.id}
                label={surface.label}
                muted={!settings || settings.enabled === false}
              >
                <SwitchControl
                  checked={preference?.proactive_enabled ?? false}
                  disabled={working || !settings || settings.enabled === false}
                  onChange={(value) =>
                    void updatePreference(surface.id, { proactive_enabled: value })
                  }
                />
              </SettingsRow>
            );
          })}
        </SettingsSectionBlock>
      )}

      {!memoryPage && (
        <MistyBriefingsSection
          working={working}
          settings={settings}
          recapSurface={recapSurface}
          setRecapSurface={setRecapSurface}
          recapDraft={recapDraft}
          setRecapDraft={setRecapDraft}
          onSave={() => void saveRecap()}
        />
      )}
      {error ? (
        <SystemErrorNotice
          error={error}
          scope="settings:misty"
          title="Misty settings need attention"
        />
      ) : null}
    </>
  );
}
