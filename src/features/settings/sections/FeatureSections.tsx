import type { AgentScope } from "@/features/agents";
import {
  agentsDeviceSnapshot,
  removeProject,
  CompanionAppearanceSettings,
} from "@/features/agents";
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
import { definitionById, fromLegacy } from "../profiles/registry";
import { useSettingsProfiles } from "../profiles/store";
import { ChoiceControl, SwitchControl } from "../SettingsControls";
import { DevicesSettings } from "./devices/DevicesSettings";
import type { SettingsContentProps } from "../settingsTypes";
import { useSettingsStore } from "../store/useSettingsStore";
import { AgentGrantsSection } from "./AgentGrantsSection";
import { AppActionsSection } from "./AppActionsSection";
import { AgentSitesSection } from "./AgentSitesSection";
import { InboundTasksSection } from "./InboundTasksSection";
import { ScreenLocationSection } from "./ScreenLocationSection";
import { PreferenceRow } from "./PreferenceRow";
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
        <p className="border-t border-charcoal-border py-3 text-sm text-cream-muted">
          Join or create a Space to manage its settings.
        </p>
      )}
    </Section>
  );
}
export { ModelSensesSection as ModelsSection } from "./ModelSensesSection";

export function AgentDefaultsSection() {
  return (
    <>
      <Section
        title="Conversations"
        description={
          "In Plan, agents research and propose a plan you approve before they change " +
          "anything. Turn Plan on or off in any chat with Shift+Tab."
        }
      >
        <CollaborationModeRow />
        <PreferenceRow id="agents.plan_deep_thinking" />
      </Section>
      <Section title="Misty panel">
        <PanelSideRow />
      </Section>
    </>
  );
}
function PanelSideRow() {
  const d = definitionById.get("agents.panel_side")!;
  const store = useSettingsStore();
  const ready = useSettingsProfiles((s) => s.ready);
  const section = store.settings?.document[d.section] as Record<string, unknown> | undefined;
  const value = String(fromLegacy(d, section?.[d.key]) || "right");
  return (
    <Row label={d.label}>
      <ChoiceControl
        disabled={store.working || !ready}
        value={value}
        onValueChange={(next) => void store.updateSetting(d.section, d.key, next)}
        options={[
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ]}
      />
    </Row>
  );
}
function CollaborationModeRow() {
  const d = definitionById.get("agents.collaboration_mode")!;
  const store = useSettingsStore();
  const ready = useSettingsProfiles((s) => s.ready);
  const section = store.settings?.document[d.section] as Record<string, unknown> | undefined;
  const value = String(fromLegacy(d, section?.[d.key]) || "act");
  return (
    <Row label={d.label} description="New chats research and propose before changing anything.">
      <SwitchControl
        disabled={store.working || !ready}
        checked={value === "plan"}
        onChange={(plan) => void store.updateSetting(d.section, d.key, plan ? "plan" : "act")}
      />
    </Row>
  );
}
export function NativeAvailability({ feature }: { feature: string }) {
  return (
    <Section title={feature}>
      <p className="border-t border-charcoal-border py-3 text-sm text-cream-muted">
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
      <ScreenLocationSection />
      <AgentSitesSection />
      <InboundTasksSection />
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
  return hasTauriInternals() ? <DevicesSettings /> : <NativeAvailability feature="Devices" />;
}
/** Remembered approvals (server-owned), and on a desktop its project folders. */
export function AgentPermissionsSection() {
  return (
    <>
      <AgentGrantsSection />
      {hasTauriInternals() ? <AgentScopeList /> : null}
    </>
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
      title="Projects"
      description="Folders on this computer your coding tool works in when a chat picks them. Add one from a chat’s Project menu."
    >
      {scopes.map((s) => (
        <Row
          key={s.id}
          label={s.displayName}
          description={
            s.kind === "project_folder"
              ? "Your coding tool works here and asks before changes that need you."
              : "Read only: agents can list and read files here."
          }
        >
          <Button
            variant="outline"
            onClick={() =>
              void (async () => {
                if (
                  !(await confirmAction(
                    `Stop using “${s.displayName}” as a project? Its files stay on this computer.`,
                    "Remove project",
                  ))
                )
                  return;
                try {
                  await removeProject(s.id);
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
        <p className="border-t border-charcoal-border py-3 text-sm text-cream-muted">
          No projects yet. Add one from a chat’s Project menu.
        </p>
      )}
      {error && (
        <p role="alert" className="border-t border-charcoal-border py-3 text-sm text-cream">
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
