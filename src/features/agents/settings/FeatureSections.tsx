import { useCachedResource } from "@/api/cache/cached_resource";
import { agentsDeviceSnapshot, forgetFolder, shareFolder } from "../personal/use_agents_store";
import { shareFolderWarning } from "../plans/AgentFolderMenu";
import { confirmAction } from "@/shared/lib/confirm_action";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, useNotice } from "@misty/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsRowSkeleton,
  useSettingsSectionAction,
} from "@/features/settings";
import { definitionById, fromLegacy } from "@/features/settings";
import { useDevicePreferences } from "@/features/settings";
import { ChoiceControl, SwitchControl } from "../../settings/SettingsControls";
import { useRailShown } from "../context-panel/rail_layout_store";
import { useShowHiddenSteps } from "../activity/RunSteps";
import { useComposerVim } from "../conversations/composer/controls/composer_vim";
import { useSettingsStore } from "@/features/settings";
import { AgentSitesSection } from "./AgentSitesSection";
import { PaymentsAskSection } from "./PaymentsAskSection";
import { PreferenceRow } from "@/features/settings";
export function AgentDefaultsSection() {
  return (
    <>
      <CollaborationModeRow />
      <PreferenceRow id="agents.plan_deep_thinking" />
      <PanelSideRow />
      <ToolsPanelRow />
      <ComposerVimRow />
      <HiddenStepsRow />
    </>
  );
}
function ComposerVimRow() {
  const on = useComposerVim((state) => state.on);
  return (
    <Row label="Vim keys in the message box">
      <SwitchControl
        checked={on}
        disabled={false}
        onChange={(value) => useComposerVim.getState().toggle(value)}
      />
    </Row>
  );
}
function HiddenStepsRow() {
  const shown = useShowHiddenSteps((state) => state.value);
  return (
    <Row label="Show housekeeping steps">
      <SwitchControl
        checked={shown}
        disabled={false}
        onChange={(value) => useShowHiddenSteps.getState().set(value)}
      />
    </Row>
  );
}
function ToolsPanelRow() {
  const shown = useRailShown((state) => state.value);
  return (
    <Row label="Show the Tools panel in chats">
      <SwitchControl
        checked={shown}
        disabled={false}
        onChange={(value) => useRailShown.getState().set(value)}
      />
    </Row>
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
export function AgentPermissionsSection() {
  return (
    <AgentSitesSection>
      <PaymentsAskSection />
    </AgentSitesSection>
  );
}
export function AgentFoldersSection() {
  const native = hasTauriInternals();
  const snapshot = useCachedResource(
    native ? "agents/device-snapshot" : null,
    agentsDeviceSnapshot,
    { persist: "device" },
  );
  const scopes = snapshot.data?.scopes ?? [];
  const [actionError, setError] = useState("");
  const loadFailed = Boolean(snapshot.error) && !snapshot.refreshing;
  const error = actionError || (loadFailed ? "Shared folders could not be loaded. Try again." : "");
  const refresh = snapshot.reload;
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
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
  useSettingsSectionAction(
    native
      ? { label: "Share a folder", icon: Plus, showLabel: true, onSelect: () => void share() }
      : undefined,
  );
  if (!native) return null;
  if (snapshot.loading)
    return <DesktopSettingsRowSkeleton label="Shared folders" rows={2} control="button" />;
  return (
    <>
      {scopes.length ? null : <Row label="No shared folders">{null}</Row>}
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
    </>
  );
}
