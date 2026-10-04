import type { AgentScope } from "@/features/agents";
import {
  agentsDeviceSnapshot,
  agentsRevokeFolderScope,
  CompanionAppearanceSettings,
  McpConnectionsView,
} from "@/features/agents";
import { peerIsOnline, useConnectedDevices } from "@/features/connected-devices";
import { ConnectedDevicePairingDialog } from "@/features/files/workspace";
import { useSpacesStore } from "@/features/spaces";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { definitionById, fromLegacy, type SettingDefinition } from "../profiles/registry";
import { useSettingsProfiles } from "../profiles/store";
import { ChoiceControl, SwitchControl, TextControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { useSettingsStore } from "../store/useSettingsStore";
import { AppActionsSection } from "./AppActionsSection";
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
        <ChoiceControl
          disabled={store.working || !ready}
          value={String(value)}
          onValueChange={update}
          options={d.enum.map((v) => ({ value: v, label: v || "Model default" }))}
        />
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
export { ModelProvidersSection as ModelsSection } from "./ModelProvidersSection";

export function AgentDefaultsSection() {
  const setActiveSection = useSettingsStore((state) => state.setActiveSection);
  return (
    <Section
      title="Models"
      description="Choose provider connections, models and reasoning for new agent tasks in Models settings."
    >
      <Row label="Provider and model choices">
        <Button variant="outline" onClick={() => setActiveSection("models")}>
          Open Models
        </Button>
      </Row>
    </Section>
  );
}
export function NativeAvailability({ feature }: { feature: string }) {
  return (
    <Section title={feature}>
      <p className="p-5 text-sm text-cream-muted">
        Open Misty on a supported device to configure {feature.toLowerCase()}. Your settings remain
        available here.
      </p>
    </Section>
  );
}
export function AgentConnectionsSection() {
  return (
    <>
      <AppActionsSection />
      <McpConnectionsView />
    </>
  );
}
export function CompanionSection() {
  return hasTauriInternals() ? (
    <CompanionAppearanceSettings />
  ) : (
    <NativeAvailability feature="Companion" />
  );
}
export function DevicesSection() {
  return hasTauriInternals() ? <DeviceControls /> : <NativeAvailability feature="File sharing" />;
}
function DeviceControls() {
  const devices = useConnectedDevices();
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState("");
  return (
    <Section title="Paired devices" description="Pair devices to send files between them.">
      <div className="flex gap-2 p-4">
        <Button variant="outline" onClick={() => setPairing(true)}>
          Pair device
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
        <p className="p-5 text-sm text-cream-muted">No devices paired for file sharing.</p>
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
