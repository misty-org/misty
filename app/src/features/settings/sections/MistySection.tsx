import { usePersonalAgentsStore } from "@/features/agents";
import { useAuth } from "@/features/auth";
import {
  aiSurfaceApi,
  type AiRecapRecord,
  type AiSurfacePreferenceRecord,
  type AiUserSettings,
} from "@/features/ai-surface/api";
import { useAiSurfaceStore } from "@/features/ai-surface/store";
import type { AiSurfaceId } from "@/features/ai-surface/types";
import { confirmAction } from "@/shared/lib/confirmAction";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@/shared/ui";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import type { SettingsContentProps } from "../settingsTypes";

const managedSurfaces: Array<{ id: AiSurfaceId; label: string }> = [
  { id: "global", label: "Global Misty" },
  { id: "notes", label: "Notes" },
  { id: "planner.tasks", label: "Planner" },
  { id: "planner.agenda", label: "Agenda" },
  { id: "planner.roadmap", label: "Roadmaps" },
  { id: "browser", label: "Browser" },
  { id: "inbox", label: "Inbox" },
  { id: "space.chat", label: "Space Chat" },
  { id: "drawings", label: "Drawings" },
  { id: "library", label: "Library" },
  { id: "photo-editor", label: "Photo editor" },
  { id: "code", label: "Code" },
  { id: "terminal", label: "Terminal" },
  { id: "files", label: "Files" },
  { id: "transfers", label: "Transfers" },
  { id: "extensions", label: "Extensions" },
  { id: "home", label: "Home" },
  { id: "activity", label: "Activity" },
];

const recapSurfaces: Array<{ id: AiRecapRecord["surface_id"]; label: string }> = [
  { id: "home", label: "Home" },
  { id: "activity", label: "Activity" },
  { id: "global", label: "Global Misty" },
];

const defaultRecapPrompt =
  "Summarize recent progress, upcoming commitments, decisions, risks, and blockers. Be concise and omit sections with no grounded evidence.";

function defaultRecap(surfaceId: AiRecapRecord["surface_id"]): AiRecapRecord {
  return {
    surface_id: surfaceId,
    enabled: false,
    cadence: "daily",
    local_time: "08:00",
    weekday: 1,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    prompt: defaultRecapPrompt,
    state: "idle",
    last_citations: [],
    updated_at: new Date(0).toISOString(),
  };
}

export function MistySection(_props: SettingsContentProps) {
  const { user } = useAuth();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const loadAgents = usePersonalAgentsStore((state) => state.load);
  const [settings, setSettings] = useState<AiUserSettings | null>(null);
  const [preferences, setPreferences] = useState<Record<string, AiSurfacePreferenceRecord>>({});
  const [recaps, setRecaps] = useState<Record<string, AiRecapRecord>>({});
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
    void loadAgents();
    void aiSurfaceApi
      .status()
      .then((result) => active && setProvider(result))
      .catch(() => undefined);
    void aiSurfaceApi
      .recaps()
      .then((result) => {
        if (!active) return;
        const values = Object.fromEntries(result.recaps.map((item) => [item.surface_id, item]));
        setRecaps(values);
        setRecapDraft(values.home ?? defaultRecap("home"));
      })
      .catch(() => undefined);
    void aiSurfaceApi
      .usage()
      .then((result) => active && setUsage(result.agent_usage ?? null))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loadAgents]);

  useEffect(() => {
    setRecapDraft(recaps[recapSurface] ?? defaultRecap(recapSurface));
  }, [recapSurface, recaps]);

  const updateSettings = async (
    enabled: boolean,
    retentionDays = settings?.retention_days ?? 30,
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
      const result = await aiSurfaceApi.updateSettings(enabled, retentionDays);
      setSettings(result.settings);
      if (!enabled && user?.id) useAiSurfaceStore.getState().clearAccount(user.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Misty settings could not be saved.");
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
        pinned_agent_id: patch.pinned_agent_id ?? current.pinned_agent_id,
        proactive_enabled: patch.proactive_enabled ?? current.proactive_enabled,
        saved_actions: patch.saved_actions ?? current.saved_actions,
      });
      setPreferences((values) => ({ ...values, [surfaceId]: result.preference }));
      if (user?.id && "pinned_agent_id" in patch) {
        useAiSurfaceStore
          .getState()
          .setPinnedAgent(user.id, surfaceId, patch.pinned_agent_id || undefined);
      }
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
            checked={settings?.enabled ?? true}
            disabled={!settings || working}
            onCheckedChange={(value) => void updateSettings(value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Conversation retention"
          description="Accepted work and required security audits follow their domain retention rules."
        >
          <Select
            value={String(settings?.retention_days ?? 30)}
            disabled={!settings || working || !settings.enabled}
            onValueChange={(value) => void updateSettings(true, Number(value))}
          >
            <SelectTrigger className="w-40">
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
          label="Dangerous actions"
          description="External, destructive, permission-changing, and device actions always require exact review and confirmation."
          last
        >
          <span className="text-xs text-cream-muted">Blanket approval disabled</span>
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock
        title="Per-surface behavior"
        description="Proactive suggestions are off by default. A pinned Agent is personal and only used for that surface."
      >
        {managedSurfaces.map((surface, index) => {
          const preference = preferences[surface.id];
          return (
            <SettingsRow
              key={surface.id}
              label={surface.label}
              last={index === managedSurfaces.length - 1}
            >
              <div className="flex w-full items-center justify-end gap-3 max-[760px]:justify-start">
                <label className="flex items-center gap-2 text-xs text-cream-muted">
                  Proactive
                  <Switch
                    checked={preference?.proactive_enabled ?? false}
                    disabled={working || settings?.enabled === false}
                    onCheckedChange={(value) =>
                      void updatePreference(surface.id, { proactive_enabled: value })
                    }
                  />
                </label>
                <Select
                  value={preference?.pinned_agent_id || "misty"}
                  disabled={working || settings?.enabled === false}
                  onValueChange={(value) =>
                    void updatePreference(surface.id, {
                      pinned_agent_id: value === "misty" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Misty" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="misty">Misty</SelectItem>
                    {agents
                      .filter((agent) => agent.enabled)
                      .map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </SettingsRow>
          );
        })}
      </SettingsSectionBlock>

      <SettingsSectionBlock
        title="Recurring briefings"
        description={
          "Personal briefings run only on an explicit schedule, use content you can still access, " +
          "and appear natively on the selected surface. They are off by default."
        }
      >
        <SettingsRow label="Deliver to">
          <Select
            value={recapSurface}
            disabled={working || settings?.enabled === false}
            onValueChange={(value) => setRecapSurface(value as AiRecapRecord["surface_id"])}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {recapSurfaces.map((surface) => (
                <SelectItem key={surface.id} value={surface.id}>
                  {surface.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Schedule">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select
              value={recapDraft.enabled ? recapDraft.cadence : "off"}
              disabled={working || settings?.enabled === false}
              onValueChange={(value) =>
                setRecapDraft((current) => ({
                  ...current,
                  enabled: value !== "off",
                  cadence: value === "weekly" ? "weekly" : "daily",
                }))
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
            {recapDraft.enabled && recapDraft.cadence === "weekly" ? (
              <Select
                value={String(recapDraft.weekday)}
                onValueChange={(value) =>
                  setRecapDraft((current) => ({ ...current, weekday: Number(value) }))
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((day, index) => (
                    <SelectItem key={day} value={String(index)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {recapDraft.enabled ? (
              <Input
                type="time"
                className="w-28"
                value={recapDraft.local_time}
                onChange={(event) =>
                  setRecapDraft((current) => ({ ...current, local_time: event.target.value }))
                }
              />
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow
          label="Briefing focus"
          description={`Runs in ${recapDraft.timezone}. Scheduled outputs are personal and cite their source objects.`}
          last
        >
          <div className="w-full max-w-md space-y-2">
            <Textarea
              rows={3}
              maxLength={8000}
              disabled={working || settings?.enabled === false}
              value={recapDraft.prompt}
              onChange={(event) =>
                setRecapDraft((current) => ({ ...current, prompt: event.target.value }))
              }
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-cream-muted">
                {recapDraft.next_run_at
                  ? `Next: ${new Date(recapDraft.next_run_at).toLocaleString()}`
                  : "No run is scheduled"}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={working || settings?.enabled === false || !recapDraft.prompt.trim()}
                onClick={() => void saveRecap()}
              >
                Save briefing
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsSectionBlock>
      {error ? (
        <p className="text-sm text-notification-red" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
