import type { AgentScope } from "@/features/agents";
import {
  agentsDeviceSnapshot,
  removeProject,
  CompanionAppearanceSettings,
} from "@/features/agents";
import { openAccountSettingsInBrowser } from "@/features/account/openAccountSettings";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { useEffect, useState } from "react";
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
      <Section title="Chat panel">
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
      <InboundTasksSection />
      <ScreenLocationSection />
    </>
  );
}
export function CompanionSection() {
  return hasTauriInternals() ? (
    <CompanionAppearanceSettings />
  ) : (
    <NativeAvailability feature="Cursor" />
  );
}
export function DevicesSection() {
  return hasTauriInternals() ? <DevicesSettings /> : <NativeAvailability feature="Devices" />;
}
/** What agents may do: remembered approvals (server-owned), project folders on a desktop, and
 * sites they only read. */
export function AgentPermissionsSection() {
  return (
    <>
      <AgentGrantsSection />
      {hasTauriInternals() ? <AgentScopeList /> : null}
      <AgentSitesSection />
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
/** The version, and the way to the account on the website, which owns billing and account data. */
export function AboutSection(props: SettingsContentProps) {
  return (
    <Section title="About">
      <Row label="Version">
        <span className="text-[15px] text-cream-muted">
          {props.app?.version ?? "Available in the installed app"}
        </span>
      </Row>
      <Row
        label="Account"
        description="Your plan, billing, invites and account data are managed on the Misty website."
      >
        <Button variant="outline" size="sm" onClick={() => void openAccountSettingsInBrowser()}>
          Manage account
        </Button>
      </Row>
    </Section>
  );
}
