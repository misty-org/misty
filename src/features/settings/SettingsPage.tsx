import { useAppStore } from "@/features/app-shell";
import { useSettingsStore } from "./store/useSettingsStore";
import {
  AppWindow,
  ArrowLeftRight,
  Bell,
  Bot,
  Eye,
  Keyboard,
  Lock,
  Rows3,
  Search,
  Settings2,
} from "lucide-react";
import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { DesktopSettingsFrame } from "./components/DesktopSettingsUI";
import { NotificationSettings } from "./components/NotificationSettings";
import {
  AgentSettings,
  AppSettings,
  AppearanceSettings,
  GeneralSettings,
} from "./settingsBasicSections";
import { SearchSettings } from "./settingsSearchSection";
import {
  AdvancedSettings,
  PrivacySettings,
  ShortcutsSettings,
  TransfersSettings,
} from "./settingsSystemSections";
import type { NavItem, SettingsContentProps, SettingsSection } from "./settingsTypes";

const appNavItems: NavItem[] = [
  { id: "general", label: "General", icon: Rows3 },
  { id: "app", label: "App", icon: AppWindow },
  { id: "agent", label: "Agents", icon: Bot },
  { id: "appearance", label: "Appearance", icon: Eye },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "transfers", label: "Transfers", icon: ArrowLeftRight },
  { id: "search", label: "Search & Library", icon: Search },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "advanced", label: "Advanced", icon: Settings2 },
];

const navItems = appNavItems;

const sectionDescriptions: Record<SettingsSection, string> = {
  general: "Files startup, default actions, and browsing behavior.",
  app: "Updates, version details, and local support information.",
  agent: "Control Agents and the actions they can perform.",
  appearance: "Density, text size, previews, and motion.",
  notifications: "Choose when important updates should reach you outside Misty.",
  privacy: "Choose what diagnostic data Misty may share.",
  transfers: "Defaults for copies, downloads, and destinations.",
  search: "Keep filenames and connected libraries searchable.",
  shortcuts: "Review and customize keyboard commands.",
  advanced: "Runtime, developer, and recovery preferences.",
};

export const SettingsWorkspace = memo(function SettingsWorkspace(props: {
  presentation?: "page" | "overlay";
  onClose?: () => void;
}) {
  const {
    activeSection,
    settings,
    launchOnLogin,
    openWithAssociations,
    shortcuts,
    working,
    setActiveSection,
    updateSetting,
    load,
    removeOpenWithAssociation,
    setShortcut,
    saveShortcuts,
  } = useSettingsStore(
    useShallow((state) => ({
      activeSection: state.activeSection,
      settings: state.settings,
      launchOnLogin: state.launchOnLogin,
      openWithAssociations: state.openWithAssociations,
      shortcuts: state.shortcuts,
      working: state.working,
      setActiveSection: state.setActiveSection,
      updateSetting: state.updateSetting,
      load: state.load,
      removeOpenWithAssociation: state.removeOpenWithAssociation,
      setShortcut: state.setShortcut,
      saveShortcuts: state.saveShortcuts,
    })),
  );
  const app = useAppStore((state) => state.app);
  const document = settings?.document ?? {};
  const title = navItems.find((item) => item.id === activeSection)?.label ?? "General";
  const controlProps = {
    document,
    launchOnLogin,
    working,
    onSettingChange: updateSetting,
    onLoad: load,
    onShortcutChange: setShortcut,
    onSaveShortcuts: saveShortcuts,
    onRemoveOpenWithAssociation: removeOpenWithAssociation,
    shortcuts: shortcuts?.bindings ?? [],
    openWithAssociations,
    app,
  };

  return (
    <DesktopSettingsFrame
      activeId={activeSection}
      ariaLabel="Settings"
      description={sectionDescriptions[activeSection]}
      items={navItems}
      navigationLabel="Settings sections"
      navigationTitle="Misty settings"
      onClose={props.onClose}
      onSelect={setActiveSection}
      presentation={props.presentation}
      title={title}
    >
      <SettingsContent activeSection={activeSection} controlProps={controlProps} />
    </DesktopSettingsFrame>
  );
});

function SettingsContent(props: {
  activeSection: SettingsSection;
  controlProps: SettingsContentProps;
}) {
  return (
    <>
      {props.activeSection === "general" ? <GeneralSettings {...props.controlProps} /> : null}
      {props.activeSection === "app" ? <AppSettings {...props.controlProps} /> : null}
      {props.activeSection === "agent" ? <AgentSettings {...props.controlProps} /> : null}
      {props.activeSection === "appearance" ? <AppearanceSettings {...props.controlProps} /> : null}
      {props.activeSection === "notifications" ? (
        <NotificationSettings {...props.controlProps} />
      ) : null}
      {props.activeSection === "privacy" ? <PrivacySettings {...props.controlProps} /> : null}
      {props.activeSection === "transfers" ? <TransfersSettings {...props.controlProps} /> : null}
      {props.activeSection === "search" ? <SearchSettings {...props.controlProps} /> : null}
      {props.activeSection === "shortcuts" ? <ShortcutsSettings {...props.controlProps} /> : null}
      {props.activeSection === "advanced" ? <AdvancedSettings {...props.controlProps} /> : null}
    </>
  );
}

export default SettingsWorkspace;
export type { SettingValue, SettingsSection } from "./settingsTypes";
