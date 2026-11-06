import type { AgentScope } from "@/features/agents";
import {
  agentsDeviceSnapshot,
  removeProject,
  CompanionAppearanceSettings,
} from "@/features/agents";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, ErrorNotification, SkeletonList } from "@/shared/ui";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { definitionById, fromLegacy } from "../devicePreferences/registry";
import { useDevicePreferences } from "../devicePreferences/store";
import { ChoiceControl, SwitchControl } from "../SettingsControls";
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
      <Section title="Defaults">
        <CollaborationModeRow />
        <PreferenceRow id="agents.plan_deep_thinking" />
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
  const ready = useDevicePreferences((s) => s.ready);
  const section = store.settings?.document[d.section] as Record<string, unknown> | undefined;
  const value = String(fromLegacy(d, section?.[d.key]) || "act");
  return (
    <Row label={d.label} description="Agents propose a plan first. Shift+Tab in any chat.">
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
/** What agents may do: remembered approvals (server-owned), project folders on a desktop, and
 * sites they only read. */
export function AgentPermissionsSection() {
  return (
    <>
      <AgentSitesSection>
        <PaymentsAskSection />
      </AgentSitesSection>
      <AgentGrantsSection />
      {hasTauriInternals() ? <AgentScopeList /> : null}
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
    return (
      <ErrorNotification message={error} onDismiss={() => setError("")}>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
          Try again
        </Button>
      </ErrorNotification>
    );
  return (
    <Section title="Projects" description="Add one from a chat’s Project menu.">
      {scopes.map((s) => (
        <Row
          key={s.id}
          label={s.displayName}
          description={s.kind === "project_folder" ? "Coding tools work here." : "Read only."}
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
      <ErrorNotification message={error} onDismiss={() => setError("")}>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
          Try again
        </Button>
      </ErrorNotification>
    </Section>
  );
}
