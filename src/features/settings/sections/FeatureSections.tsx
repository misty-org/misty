import { assistantApi, type FrontierModel } from "@/api/assistant/api";
import type { AgentScope } from "@/features/agents";
import {
  agentsDeviceSnapshot,
  agentsRevokeFolderScope,
  CompanionAppearanceSettings,
  McpConnectionsView,
} from "@/features/agents";
import { peerIsOnline, useConnectedDevices } from "@/features/connected-devices";
import { ConnectedDevicePairingDialog } from "@/features/files/workspace";
import { ConnectedStoragePanel } from "@/features/providers";
import { useSpacesStore } from "@/features/spaces";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Input } from "@/shared/ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { definitionById, fromLegacy, type SettingDefinition } from "../profiles/registry";
import { useSettingsProfiles } from "../profiles/store";
import { SwitchControl, TextControl } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { useSettingsStore } from "../store/useSettingsStore";
const field =
  "min-h-9 w-full max-w-72 rounded-md border border-charcoal-border bg-charcoal-bg px-3 py-2 text-sm text-cream";
export function PreferenceRow({ id }: { id: string }) {
  const d = definitionById.get(id)!;
  const store = useSettingsStore();
  const ready = useSettingsProfiles((s) => s.ready);
  const section = store.settings?.document[d.section] as Record<string, unknown> | undefined;
  const value = fromLegacy(d, section?.[d.key]);
  const update = (next: string | number | boolean) =>
    store.updateSetting(
      d.section,
      d.key,
      d.legacyValues ? d.legacyValues.indexOf(String(next)) : next,
    );
  return (
    <Row label={d.label}>
      {d.type === "boolean" ? (
        <SwitchControl
          checked={Boolean(value)}
          disabled={store.working || !ready}
          onChange={update}
        />
      ) : d.enum ? (
        <select
          className={field}
          aria-label={d.label}
          disabled={store.working || !ready}
          value={String(value)}
          onChange={(e) => update(e.target.value)}
        >
          {d.enum.map((v) => (
            <option value={v} key={v}>
              {v || "Model default"}
            </option>
          ))}
        </select>
      ) : (
        <TextControl value={String(value)} disabled={store.working || !ready} onCommit={update} />
      )}
    </Row>
  );
}
export function SpaceDefaultsSection() {
  return (
    <Section
      title="Opening a Space"
      description="Used when opening a Space without an explicit destination. Restored sessions keep their place."
    >
      <PreferenceRow id="spaces.openingTool" />
    </Section>
  );
}
export function SpaceAgendaSection() {
  return (
    <Section
      title="Agenda defaults"
      description="Existing choices in individual Spaces take precedence."
    >
      <PreferenceRow id="spaces.agenda.tasks" />
      <PreferenceRow id="spaces.agenda.roadmap" />
    </Section>
  );
}
export function ManageSpacesSection(props: SettingsContentProps) {
  const spaces = useSpacesStore((s) => s.spaces);
  const navigate = useNavigate();
  return (
    <Section
      title="Your Spaces"
      description="These settings belong to the selected Space and follow its membership permissions."
    >
      {spaces.length ? (
        spaces.map((s) => (
          <Row key={s.id} label={s.name} description={s.role}>
            <Button
              variant="outline"
              onClick={() =>
                (props.onOpenResource ?? navigate)(
                  `/spaces/${encodeURIComponent(s.id)}/settings/general`,
                )
              }
            >
              Manage Space
            </Button>
          </Row>
        ))
      ) : (
        <p className="p-5 text-sm text-cream-muted">
          Join or create a Space to manage its settings.
        </p>
      )}
    </Section>
  );
}
function useModels() {
  const [models, setModels] = useState<FrontierModel[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [attempt, retry] = useState(0),
    [defaultModel, setDefaultModel] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void assistantApi
      .frontierModels()
      .then((r) => {
        if (active) {
          setModels(r.models);
          setDefaultModel(r.default_model_id);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return {
    models,
    defaultModel,
    error,
    loading,
    retry: () => retry((n) => n + 1),
  };
}
export function ModelsSection() {
  const { models, error, loading, retry } = useModels();
  const [query, setQuery] = useState("");
  return (
    <Section title="Available models">
      <Input
        aria-label="Filter models"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter models"
      />
      {loading && (
        <p role="status" className="p-5 text-sm text-cream-muted">
          Loading available models…
        </p>
      )}
      {models
        .filter((m) => `${m.name} ${m.provider_name}`.toLowerCase().includes(query.toLowerCase()))
        .map((m) => (
          <Row key={m.id} label={m.name} description={m.provider_name}>
            <span className="text-xs text-cream-muted">{m.capabilities.join(", ") || "Chat"}</span>
          </Row>
        ))}
      {!loading && !models.length && !error && (
        <p className="p-5 text-sm text-cream-muted">No models are available from this server.</p>
      )}
      {error && (
        <div className="p-5">
          <p role="alert">{error}</p>
          <Button onClick={retry} variant="outline">
            Retry
          </Button>
        </div>
      )}
    </Section>
  );
}
export function AgentDefaultsSection(props: SettingsContentProps) {
  const { models, defaultModel, error, loading, retry } = useModels();
  const agent = (props.document.agent ?? {}) as Record<string, unknown>;
  const model = String(agent.default_model_id ?? definitionById.get("agents.model")!.default);
  const chosen = models.find((m) => m.id === (model || defaultModel));
  const reasoning = String(agent.default_reasoning_effort ?? "");
  const levels = chosen?.reasoning_levels.filter((l) => l !== "default") ?? [];
  return (
    <Section
      title="New conversations"
      description="Individual agent and conversation choices take precedence. Existing conversations stay unchanged."
    >
      <Row label="Default model">
        <select
          className={field}
          aria-label="Default model"
          value={model}
          disabled={loading || !!error || props.working}
          onChange={(e) => {
            const next = models.find((m) => m.id === (e.target.value || defaultModel));
            props.onSettingChange("agent", "default_model_id", e.target.value);
            if (reasoning && !next?.reasoning_levels.some((level) => level === reasoning))
              props.onSettingChange("agent", "default_reasoning_effort", "");
          }}
        >
          <option value="">Server default</option>
          {model && !chosen && (
            <option value={model}>{loading ? "Loading…" : `${model} (unavailable)`}</option>
          )}
          {models.map((m) => (
            <option value={m.id} key={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Row>
      <Row
        label="Default reasoning"
        description={!levels.length ? "This model uses its own reasoning defaults." : undefined}
      >
        <select
          className={field}
          aria-label="Default reasoning"
          value={levels.some((level) => level === reasoning) ? reasoning : ""}
          disabled={!levels.length || props.working}
          onChange={(e) =>
            props.onSettingChange("agent", "default_reasoning_effort", e.target.value)
          }
        >
          <option value="">Model default</option>
          {levels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Row>
      {error && (
        <div className="p-5">
          <p role="alert">{error}</p>
          <Button variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )}
    </Section>
  );
}
export function NativeAvailability({ feature }: { feature: string }) {
  return (
    <Section title={feature}>
      <p className="p-5 text-sm text-cream-muted">
        Open Misty on a supported device to configure {feature.toLowerCase()}. Your profile
        preferences remain available here.
      </p>
    </Section>
  );
}
export function FileConnectionsSection(props: SettingsContentProps) {
  const navigate = useNavigate();
  return hasTauriInternals() ? (
    <ConnectedStoragePanel onClose={() => (props.onOpenResource ?? navigate)("/files")} />
  ) : (
    <NativeAvailability feature="File connections" />
  );
}
export function AgentConnectionsSection() {
  return <McpConnectionsView />;
}
export function CompanionSection() {
  return hasTauriInternals() ? (
    <CompanionAppearanceSettings />
  ) : (
    <NativeAvailability feature="Companion" />
  );
}
export function DevicesSection() {
  return hasTauriInternals() ? <DeviceControls /> : <NativeAvailability feature="Devices" />;
}
function DeviceControls() {
  const devices = useConnectedDevices();
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState("");
  return (
    <Section title="Connected devices">
      <div className="flex gap-2 p-4">
        <Button variant="outline" onClick={() => setPairing(true)}>
          Connect device
        </Button>
        <Button
          variant="ghost"
          onClick={() => void devices.refresh().catch((e) => setError(String(e)))}
        >
          Refresh
        </Button>
      </div>
      {devices.peers.map((peer) => (
        <Row
          key={peer.pairId}
          label={peer.name}
          description={peerIsOnline(peer) ? "Online" : "Offline"}
        >
          <Button
            variant="outline"
            onClick={() => void devices.unpair(peer).catch((e) => setError(String(e)))}
          >
            Disconnect
          </Button>
        </Row>
      ))}
      {!devices.peers.length && (
        <p className="p-5 text-sm text-cream-muted">No connected devices.</p>
      )}
      {(error || devices.error) && (
        <p role="alert" className="p-5">
          {error || devices.error}
        </p>
      )}
      <ConnectedDevicePairingDialog controller={devices} open={pairing} onOpenChange={setPairing} />
    </Section>
  );
}
export function AgentPermissionsSection() {
  return hasTauriInternals() ? (
    <AgentScopeList />
  ) : (
    <NativeAvailability feature="Device permissions" />
  );
}
function AgentScopeList() {
  const [scopes, setScopes] = useState<AgentScope[]>([]),
    [error, setError] = useState("");
  const refresh = () =>
    agentsDeviceSnapshot()
      .then((s) => setScopes(s.scopes))
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <Section
      title="Folder access"
      description="Agents use explicitly granted folders. External and destructive actions still require review."
    >
      {scopes.map((s) => (
        <Row key={s.id} label={s.displayName}>
          <Button
            variant="outline"
            onClick={() =>
              void (async () => {
                if (
                  !(await confirmAction(
                    `Remove access to “${s.displayName}”? Files remain on this device.`,
                    "Remove folder access",
                  ))
                )
                  return;
                try {
                  await agentsRevokeFolderScope(s.id);
                  await refresh();
                } catch (e) {
                  setError(String(e));
                }
              })()
            }
          >
            Remove access
          </Button>
        </Row>
      ))}
      {!scopes.length && (
        <p className="p-5 text-sm text-cream-muted">
          No folders have been granted. Choose a folder from Files when starting an agent task.
        </p>
      )}
      <Button className="m-4" variant="outline" onClick={() => void refresh()}>
        Refresh permissions
      </Button>
      {error && (
        <p role="alert" className="p-5">
          {error}
        </p>
      )}
    </Section>
  );
}
export function AboutSection(props: SettingsContentProps) {
  return (
    <Section title="Misty" description="Your workspace for Browser, Spaces, Files and Agents.">
      <Row label="Version">
        <span className="text-sm">{props.app?.version ?? "Available in the installed app"}</span>
      </Row>
    </Section>
  );
}
export type { SettingDefinition };
