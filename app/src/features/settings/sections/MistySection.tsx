import { useAuth } from "@/features/auth";
import { SystemErrorActivity } from "@/features/activity";
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
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@/shared/ui";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { settingsDisabledControlClass } from "../settingsConstants";
import type { SettingsContentProps } from "../settingsTypes";
import { MistyBriefingsSection } from "./MistyBriefingsSection";
import { defaultRecap, managedSurfaces } from "./mistySettingsConfig";

export function MistySection(_props: SettingsContentProps) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AiUserSettings | null>(null);
  const [preferences, setPreferences] = useState<Record<string, AiSurfacePreferenceRecord>>({});
  const [recaps, setRecaps] = useState<Record<string, AiRecapRecord>>({});
  const [memories, setMemories] = useState<AiMemoryRecord[]>([]);
  const [recapSurface, setRecapSurface] = useState<AiRecapRecord["surface_id"]>("home");
  const [recapDraft, setRecapDraft] = useState<AiRecapRecord>(() => defaultRecap("home"));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<{ configured: boolean; model_name: string } | null>(
    null,
  );
  const [usage, setUsage] = useState<{
    percentage_used: number;
    available: boolean;
    reset_at?: string;
  } | null>(null);

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
      .catch(
        (reason: unknown) =>
          active &&
          setError(reason instanceof Error ? reason.message : "Misty settings could not load."),
      );
    void aiSurfaceApi
      .status()
      .then((result) => active && setProvider(result))
      .catch(() => undefined);
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
          setRecapDraft(values.home ?? defaultRecap("home"));
        })
        .catch(() => undefined);
    }
    void aiSurfaceApi
      .usage()
      .then((result) => active && setUsage(result.agent_usage ?? null))
      .catch(() => undefined);
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Misty settings could not be saved.");
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That memory could not be forgotten.");
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
        pinned_agent_id: "",
        proactive_enabled: patch.proactive_enabled ?? current.proactive_enabled,
        saved_actions: patch.saved_actions ?? current.saved_actions,
      });
      setPreferences((values) => ({ ...values, [surfaceId]: result.preference }));
      window.dispatchEvent(new Event("misty:ai-preferences-changed"));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The surface preference could not be saved.",
      );
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
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The recurring briefing could not be saved.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <SettingsSectionBlock
        title="Misty everywhere"
        description="Misty is the built-in contextual copilot. Agents remains the destination for durable conversations, configuration, and delegated work."
      >
        <SettingsRow
          label="Enable Misty"
          description="Allow hosted AI in embedded surfaces and Global Misty. Lexical search continues when this is off."
        >
          <Switch
            aria-label="Enable Misty"
            className="disabled:border-charcoal-border/80 disabled:bg-charcoal-bg disabled:opacity-100 disabled:[&_[data-slot=switch-thumb]]:bg-charcoal-border"
            checked={settings?.enabled ?? false}
            disabled={!settings || working}
            onCheckedChange={(value) => void updateSettings(value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Conversation retention"
          description="Accepted work and required security audits follow their domain retention rules."
          muted={!settings || !settings.enabled}
        >
          <Select
            value={String(settings?.retention_days ?? 30)}
            disabled={!settings || working || !settings.enabled}
            onValueChange={(value) => void updateSettings(true, Number(value))}
          >
            <SelectTrigger
              aria-label="Conversation retention"
              className={`w-40 ${settingsDisabledControlClass}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[7, 30, 90, 365].map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {days} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Hosted provider"
          description="Embedded and shared Misty features use the administrator-configured hosted provider. Code BYOK stays isolated."
        >
          <span className="text-sm text-cream-muted">
            {provider === null
              ? "Checking…"
              : provider.configured
                ? provider.model_name
                : "Unavailable — lexical search only"}
          </span>
        </SettingsRow>
        <SettingsRow
          label="Weekly hosted AI"
          description="All embedded surfaces use the same account-level weekly pool; higher plans receive a larger pool."
        >
          <span className="text-sm text-cream-muted">
            {usage
              ? `${Math.min(100, Math.max(0, usage.percentage_used)).toFixed(0)}% used${
                  usage.reset_at ? ` · resets ${new Date(usage.reset_at).toLocaleDateString()}` : ""
                }`
              : "Usage unavailable"}
          </span>
        </SettingsRow>
        <SettingsRow
          label="Purge status"
          description="Database deletion is transactional; device caches and object storage are verified by a high-priority cleanup job."
          last
        >
          <span className="text-sm capitalize text-cream-muted">
            {settings?.purge_state ?? "none"}
          </span>
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock
        title="Context and privacy"
        description={
          "Pane Misty starts with only the visible object and explicitly attached context. Global Misty can retrieve " +
          "across Spaces you can currently access. Content from pages, mail, files, chat, providers, and extensions " +
          "is treated as untrusted data and cannot grant capabilities."
        }
      >
        <SettingsRow
          label="Personal by default"
          description="Corrections, rankings, pinned Agents, and saved actions remain personal unless you explicitly share an action with a Space."
        >
          <span className="text-xs text-cream-muted">Never shared silently</span>
        </SettingsRow>
        <SettingsRow
          label="Remembered context"
          description="Misty saves a detail only when you explicitly ask it to remember. Memories stay private to you, even when scoped to a Space."
          muted={!settings || !settings.enabled}
        >
          <Switch
            aria-label="Use remembered context"
            className="disabled:border-charcoal-border/80 disabled:bg-charcoal-bg disabled:opacity-100 disabled:[&_[data-slot=switch-thumb]]:bg-charcoal-border"
            checked={settings?.memory_enabled ?? false}
            disabled={!settings || working || !settings.enabled}
            onCheckedChange={(value) =>
              void updateSettings(true, settings?.retention_days ?? 30, value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Dangerous actions"
          description="External, destructive, permission-changing, and device actions always require exact review and confirmation."
          last
        >
          <span className="text-xs text-cream-muted">Blanket approval disabled</span>
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock
        title="Remembered details"
        description="Review exactly what Misty can recall. Forgetting a detail removes it from future conversations."
      >
        {memories.length === 0 ? (
          <div className="px-5 py-4 text-[13px] text-cream-muted">Nothing remembered yet.</div>
        ) : (
          memories.map((memory, index) => (
            <SettingsRow
              key={memory.id}
              label={
                memory.kind === "instruction"
                  ? "Standing instruction"
                  : memory.kind === "preference"
                    ? "Preference"
                    : "Detail"
              }
              description={
                memory.space_id
                  ? "Private · used only in its Space"
                  : "Private · available across Misty"
              }
              last={index === memories.length - 1}
            >
              <div className="flex w-full min-w-0 items-center justify-end gap-3 max-[760px]:justify-between">
                <span className="min-w-0 flex-1 truncate text-right text-[13px] text-cream max-[760px]:text-left">
                  {memory.content}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={settingsDisabledControlClass}
                  disabled={working}
                  aria-label={`Forget ${memory.content}`}
                  onClick={() => void forgetMemory(memory.id)}
                >
                  Forget
                </Button>
              </div>
            </SettingsRow>
          ))
        )}
      </SettingsSectionBlock>

      <SettingsSectionBlock
        title="Per-surface behavior"
        description={
          "Proactive suggestions are off by default. When enabled, a quiet nudge explains " +
          "why it appeared, respects cooldowns and snooze, and never starts work until you review it."
        }
      >
        {managedSurfaces.map((surface, index) => {
          const preference = preferences[surface.id];
          return (
            <SettingsRow
              key={surface.id}
              label={surface.label}
              muted={!settings || settings.enabled === false}
              last={index === managedSurfaces.length - 1}
            >
              <div className="flex w-full items-center justify-end gap-3 max-[760px]:justify-start">
                <Switch
                  aria-label={`Proactive suggestions in ${surface.label}`}
                  className={
                    "disabled:border-charcoal-border/80 disabled:bg-charcoal-bg " +
                    "disabled:opacity-100 " +
                    "disabled:[&_[data-slot=switch-thumb]]:bg-charcoal-border"
                  }
                  checked={preference?.proactive_enabled ?? false}
                  disabled={working || !settings || settings.enabled === false}
                  onCheckedChange={(value) =>
                    void updatePreference(surface.id, { proactive_enabled: value })
                  }
                />
              </div>
            </SettingsRow>
          );
        })}
      </SettingsSectionBlock>

      <MistyBriefingsSection
        working={working}
        settings={settings}
        recapSurface={recapSurface}
        setRecapSurface={setRecapSurface}
        recapDraft={recapDraft}
        setRecapDraft={setRecapDraft}
        onSave={() => void saveRecap()}
      />
      {error ? (
        <SystemErrorActivity
          error={error}
          scope="settings:misty"
          title="Misty settings need attention"
        />
      ) : null}
    </>
  );
}
