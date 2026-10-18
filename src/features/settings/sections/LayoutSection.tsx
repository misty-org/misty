import {
  layoutForOrientation,
  tabOrientation,
  type TabOrientation,
} from "@/features/app-shell/dockingLayout";
import { useWorkspaceStore, useWindowDockingLayout } from "@/features/workspace";
import { DesktopSettingsSection, DesktopSettingsRow } from "../components/DesktopSettingsUI";
import { ChoiceControl } from "../SettingsControls";
import { SavedLayoutsSettings } from "./SavedLayoutsSettings";
import { useSpaceWindowStore } from "@/features/workspace/spaceWindow";

export function LayoutSection() {
  const windowId = useWorkspaceStore((state) => state.activeWindowId);
  return (
    <>
      <WindowLayoutEditor key={windowId} />
      <SavedLayoutsSettings />
    </>
  );
}

function WindowLayoutEditor() {
  const layout = useWindowDockingLayout();
  const setLayout = useWorkspaceStore((state) => state.setWindowDockingLayout);
  const windowName = useSpaceWindowStore((state) => state.space?.name ?? "this window");
  return (
    <DesktopSettingsSection
      title={`Layout for ${windowName}`}
      description="Changes apply immediately to this Space's window and keep your open pages in place."
    >
      <DesktopSettingsRow
        label="Tabs"
        description="Vertical tabs also hold the address bar, like Zen."
      >
        <ChoiceControl
          value={tabOrientation(layout)}
          disabled={false}
          options={[
            { value: "horizontal", label: "Horizontal" },
            { value: "vertical", label: "Vertical" },
          ]}
          onValueChange={(value) =>
            setLayout(layoutForOrientation(value as TabOrientation, layout))
          }
        />
      </DesktopSettingsRow>
    </DesktopSettingsSection>
  );
}
