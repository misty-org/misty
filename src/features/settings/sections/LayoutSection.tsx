import {
  dockPositions,
  type DockingLayout,
  type DockPosition,
} from "@/features/app-shell/dockingLayout";
import { useWorkspaceStore, useWindowDockingLayout } from "@/features/workspace";
import { DesktopSettingsSection, DesktopSettingsRow } from "../components/DesktopSettingsUI";
import { booleanSetting, ChoiceControl, SwitchControl } from "../SettingsControls";
import { useSettingsStore } from "../store/useSettingsStore";
import { useSettingsProfiles } from "../profiles/store";
import { LayoutNavigationSettings } from "./LayoutNavigationSettings";
import { SavedLayoutsSettings } from "./SavedLayoutsSettings";

export function LayoutSection() {
  const windowId = useWorkspaceStore((state) => state.activeWindowId);
  const { settings, working, updateSetting } = useSettingsStore();
  const ready = useSettingsProfiles((state) => state.ready);
  return (
    <>
      <DesktopSettingsSection title="Navigation">
        <DesktopSettingsRow
          label="Auto-hide navigation"
          description="Hide the icon rail until you move to the window edge. This setting applies across your devices."
        >
          <SwitchControl
            checked={booleanSetting(
              settings?.document ?? {},
              "appearance",
              "navigator_auto_hide",
              false,
            )}
            disabled={working || !ready}
            onChange={(value) => updateSetting("appearance", "navigator_auto_hide", value)}
          />
        </DesktopSettingsRow>
      </DesktopSettingsSection>
      <LayoutNavigationSettings />
      <WindowLayoutEditor key={windowId} />
      <SavedLayoutsSettings />
    </>
  );
}

function WindowLayoutEditor() {
  const layout = useWindowDockingLayout();
  const setLayout = useWorkspaceStore((state) => state.setWindowDockingLayout);
  const windowName = useWorkspaceStore(
    (state) =>
      state.windowsByScope[state.activeScopeKey]?.find(
        (window) => window.id === state.activeWindowId,
      )?.title ?? "this window",
  );
  const setPosition = (part: keyof DockingLayout, position: DockPosition) =>
    setLayout({ ...layout, [part]: position });
  return (
    <DesktopSettingsSection
      title={`Layout for ${windowName}`}
      description={
        "Choose an edge for navigation and tabs. On the same edge, tabs sit inside navigation. " +
        "Changes apply immediately to this virtual window and keep your open pages in place."
      }
    >
      {(["navigation", "tabs"] as const).map((part) => (
        <DesktopSettingsRow
          key={part}
          label={part === "navigation" ? "Navigation position" : "Tabs position"}
        >
          <ChoiceControl
            value={layout[part]}
            disabled={false}
            options={dockPositions.map((position) => ({
              value: position,
              label: position[0].toUpperCase() + position.slice(1),
            }))}
            onValueChange={(position) => setPosition(part, position as DockPosition)}
          />
        </DesktopSettingsRow>
      ))}
    </DesktopSettingsSection>
  );
}
