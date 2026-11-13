import type { AgentScope } from "../personal/agentScope";
import { agentsDeviceSnapshot, forgetFolder, shareFolder } from "../personal/useAgentsStore";
import { shareFolderWarning } from "../plans/AgentFolderMenu";
import { TutorSettings } from "../tutor/cursor/TutorSettings";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, useNotice, SkeletonList } from "@/shared/ui";
import { useEffect, useState } from "react";
import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";
import { definitionById, fromLegacy } from "@/features/settings";
import { useDevicePreferences } from "@/features/settings";
import { ChoiceControl, SwitchControl } from "../../settings/SettingsControls";
import { useSettingsStore } from "@/features/settings";
import { AgentGrantsSection } from "./AgentGrantsSection";
import { AgentSitesSection } from "./AgentSitesSection";
import { PaymentsAskSection } from "./PaymentsAskSection";
import { SandboxPermissionsSection } from "./SandboxPermissionsSection";
import { ScreenLocationSection } from "./ScreenLocationSection";
import { PreferenceRow } from "@/features/settings";
export function AgentDefaultsSection() {
  return (
    <>
      <Section title="Defaults">
        <CollaborationModeRow />
        <PreferenceRow id="agents.plan_deep_thinking" />
        <PanelSideRow />
        <PreferenceRow id="agents.studio_sounds" />
        <PreferenceRow id="agents.run_notifications" />
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
export function CompanionSection() {
  return <TutorSettings />;
}
/** What agents may do: remembered approvals (server-owned), shared folders on a desktop, and
 * sites they only read. Then what Misty itself may reach on this computer. */
export function AgentPermissionsSection() {
  return (
    <>
      <AgentSitesSection>
        <PaymentsAskSection />
      </AgentSitesSection>
      <AgentGrantsSection />
      {hasTauriInternals() ? <AgentScopeList /> : null}
      {hasTauriInternals() ? <SandboxPermissionsSection /> : null}
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
      .catch(() => setError("Shared folders could not be loaded. Try again."))
      .finally(() => setLoading(false));
  useEffect(() => {
    void refresh();
  }, []);
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  if (loading)
    return (
      <Section title="Shared folders">
        <SkeletonList lines={2} label="Shared folders" rows={2} leading="none" trailing />
      </Section>
    );
  const share = async () => {
    if (!(await confirmAction(shareFolderWarning, "Share a folder"))) return;
    try {
      await shareFolder();
      await refresh();
    } catch (failure) {
      const text = typeof failure === "string" ? failure : "";
      setError(text && !text.includes("_") ? text : "That folder couldn’t be shared.");
    }
  };
  return (
    <Section title="Shared folders">
      {scopes.map((s) => (
        <Row key={s.id} label={s.displayName}>
          <Button
            onClick={() =>
              void (async () => {
                if (
                  !(await confirmAction(
                    `Stop sharing “${s.displayName}” with agents? Its files stay on this computer.`,
                    "Stop sharing",
                  ))
                )
                  return;
                try {
                  await forgetFolder(s.id);
                  await refresh();
                } catch {
                  setError("Folder access could not be removed. Try again.");
                }
              })()
            }
          >
            Stop sharing
          </Button>
        </Row>
      ))}
      <Row label="Add a folder">
        <Button onClick={() => void share()}>Share a folder</Button>
      </Row>
    </Section>
  );
}
