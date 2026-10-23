import type { AgentScope } from "@/features/agents";
import {
  agentsDeviceSnapshot,
  removeProject,
  CompanionAppearanceSettings,
} from "@/features/agents";
import { openAccountSettingsInBrowser } from "@/features/account/openAccountSettings";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, SkeletonList } from "@/shared/ui";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { definitionById, fromLegacy } from "../devicePreferences/registry";
import { useDevicePreferences } from "../devicePreferences/store";
import { ChoiceControl, SwitchControl } from "../SettingsControls";
import { DevicesSettings } from "./devices/DevicesSettings";
import { useSettingsStore } from "../store/useSettingsStore";
import { AgentGrantsSection } from "./AgentGrantsSection";
import { AgentSitesSection } from "./AgentSitesSection";
import { InboundTasksSection } from "./InboundTasksSection";
import { PaymentsAskSection } from "./PaymentsAskSection";
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
      <Section
        title="Chat panel"
        description="Choose which side of the current window hosts the agent panel."
      >
        <PanelSideRow />
      </Section>
      <ScreenLocationSection />
    </>
  );
}
function PanelSideRow() {
  const d = definitionById.get("agents.panel_side")!;
  const store = useSettingsStore();
  const ready = useDevicePreferences((s) => s.ready);
  const section = store.settings?.document[d.section] as Record<string, unknown> | undefined;
  const value = String(fromLegacy(d, section?.[d.key]) || "right");
  return (
    <Row
      label={d.label}
      description="Sets the default for new chats; change it any time with Shift+Tab."
    >
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
  const ready = useDevicePreferences((s) => s.ready);
  const section = store.settings?.document[d.section] as Record<string, unknown> | undefined;
  const value = String(fromLegacy(d, section?.[d.key]) || "act");
  return (
    <Row
      label={d.label}
      description="Sets the default for new chats; change it any time with Shift+Tab."
    >
      <SwitchControl
        disabled={store.working || !ready}
        checked={value === "plan"}
        onChange={(plan) => void store.updateSetting(d.section, d.key, plan ? "plan" : "act")}
      />
    </Row>
  );
}
export function AgentConnectionsSection() {
  return <InboundTasksSection />;
}
export function CompanionSection() {
  return hasTauriInternals() ? <CompanionAppearanceSettings /> : null;
}
export function DevicesSection() {
  return hasTauriInternals() ? <DevicesSettings /> : null;
}
/** What agents may do: remembered approvals (server-owned), project folders on a desktop, and
 * sites they only read. */
export function AgentPermissionsSection() {
  return (
    <>
      <PaymentsAskSection />
      <AgentGrantsSection />
      {hasTauriInternals() ? <AgentScopeList /> : null}
      <AgentSitesSection />
    </>
  );
}
function AgentScopeList() {
  const [scopes, setScopes] = useState<AgentScope[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const refresh = () =>
    agentsDeviceSnapshot()
      .then((s) => {
        setScopes(s.scopes);
        setError("");
      })
      .catch(() => setError("Project folders could not be loaded. Try again."))
      .finally(() => setLoading(false));
  useEffect(() => {
    void refresh();
  }, []);
  if (loading)
    return (
      <Section title="Projects">
        <SkeletonList label="Projects" rows={2} leading="none" trailing />
      </Section>
    );
  if (!scopes.length)
    return error ? (
      <Section title="Projects">
        <p role="alert" className="text-sm text-cream-muted">
          Project folders could not be loaded.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void refresh()}
        >
          Try again
        </Button>
      </Section>
    ) : null;
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
                } catch {
                  setError("Project access could not be removed. Try again.");
                }
              })()
            }
          >
            Remove access
          </Button>
        </Row>
      ))}
      {error && (
        <p role="alert" className="py-2 text-sm text-cream-muted">
          {error}
          <Button
            type="button"
            variant="link"
            className="ml-2 h-auto p-0"
            onClick={() => void refresh()}
          >
            Try again
          </Button>
        </p>
      )}
    </Section>
  );
}
/** The way to the account on the website, which owns billing and account data. */
export function AboutSection() {
  return (
    <Section title="Account">
      <Row
        label="Plan and billing"
        description="Your plan, billing, invites and account data are managed on the Misty website."
      >
        <Button variant="outline" size="sm" onClick={() => void openAccountSettingsInBrowser()}>
          Manage account
        </Button>
      </Row>
    </Section>
  );
}
