import { DesktopSettingsFrame } from "./components/DesktopSettingsUI";
import {
  canonicalSettingsSection,
  settingsRegistry,
} from "./settingsRegistry";

export { canonicalSettingsSection, settingsRegistry };
export type { SettingsArea, SettingsRegistryEntry } from "./settingsRegistry";

export interface SettingsWorkspaceProps {
  presentation?: "page" | "overlay";
  onClose?: () => void;
}

export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  return (
    <DesktopSettingsFrame
      activeId="settings"
      ariaLabel="Settings"
      groups={[]}
      navigationLabel="Settings sections"
      onClose={props.onClose}
      onSelect={() => {}}
      presentation={props.presentation}
      title="Settings"
    >
      <div className="flex min-h-[calc(100dvh-7rem)] items-center justify-center text-center">
        <p className="text-[15px] leading-6 text-cream-muted">
          settings development in progress
        </p>
      </div>
    </DesktopSettingsFrame>
  );
}

export default SettingsWorkspace;
export type { SettingsSection } from "./settingsTypes";
