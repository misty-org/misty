import { useAppStore } from "@/features/app-shell";
import { useSettingsStore } from "./store/useSettingsStore";
import {
  ArrowLeftRight,
  Bell,
  Bot,
  Blocks,
  Code,
  DownloadCloud,
  Eye,
  FolderOpen,
  Globe,
  Keyboard,
  Lock,
  Rows3,
  Search,
  Settings2,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { memo, type ComponentType } from "react";
import { useShallow } from "zustand/react/shallow";
import { DesktopSettingsFrame } from "./components/DesktopSettingsUI";
import { AdvancedSection } from "./sections/AdvancedSection";
import { AgentsSection } from "./sections/AgentsSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { BrowserSection } from "./sections/BrowserSection";
import { CodeSection } from "./sections/CodeSection";
import { ExtensionsSection } from "./sections/ExtensionsSection";
import { FilesSection } from "./sections/FilesSection";
import { GeneralSection } from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { PrivacySection } from "./sections/PrivacySection";
import { SearchSection } from "./sections/SearchSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { TerminalSection } from "./sections/TerminalSection";
import { TransfersSection } from "./sections/TransfersSection";
import { UpdatesSection } from "./sections/UpdatesSection";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";
import type { LucideIcon } from "lucide-react";

/**
 * The one place a section is declared.
 *
 * `group` captions the nav rail. Sixteen entries need the break, and the
 * caption is what tells you whether a section configures the app itself or one
 * of its tools.
 */
export type SettingsGroup = "app" | "tools" | "system";

/** Rail captions, drawn with the global navigator's section-header treatment. */
const groupLabels: Record<SettingsGroup, string> = {
  app: "App",
  tools: "Tools",
  system: "System",
};

export interface SettingsRegistryEntry {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: SettingsGroup;
  Component: ComponentType<SettingsContentProps>;
}

export const settingsRegistry: readonly SettingsRegistryEntry[] = [
  { id: "general", label: "General", icon: Rows3, group: "app", Component: GeneralSection },
  { id: "appearance", label: "Appearance", icon: Eye, group: "app", Component: AppearanceSection },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    group: "app",
    Component: NotificationsSection,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: Keyboard,
    group: "app",
    Component: ShortcutsSection,
  },

  { id: "files", label: "Files", icon: FolderOpen, group: "tools", Component: FilesSection },
  { id: "search", label: "Search", icon: Search, group: "tools", Component: SearchSection },
  {
    id: "transfers",
    label: "Transfers",
    icon: ArrowLeftRight,
    group: "tools",
    Component: TransfersSection,
  },
  { id: "browser", label: "Browser", icon: Globe, group: "tools", Component: BrowserSection },
  {
    id: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
    group: "tools",
    Component: TerminalSection,
  },
  { id: "code", label: "Code", icon: Code, group: "tools", Component: CodeSection },
  { id: "models", label: "Models", icon: Sparkles, group: "tools", Component: ModelsSection },
  { id: "agents", label: "Agents", icon: Bot, group: "tools", Component: AgentsSection },
  {
    id: "extensions",
    label: "Extensions",
    icon: Blocks,
    group: "tools",
    Component: ExtensionsSection,
  },

  { id: "privacy", label: "Privacy", icon: Lock, group: "system", Component: PrivacySection },
  {
    id: "updates",
    label: "Updates",
    icon: DownloadCloud,
    group: "system",
    Component: UpdatesSection,
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: Settings2,
    group: "system",
    Component: AdvancedSection,
  },
];

const navItems = settingsRegistry.map(({ id, label, icon, group }) => ({
  id,
  label,
  icon,
  group,
  groupLabel: groupLabels[group],
}));

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
    resetShortcuts,
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
      resetShortcuts: state.resetShortcuts,
    })),
  );
  const app = useAppStore((state) => state.app);
  const document = settings?.document ?? {};
  const entry = settingsRegistry.find((item) => item.id === activeSection) ?? settingsRegistry[0];
  const controlProps: SettingsContentProps = {
    document,
    launchOnLogin,
    working,
    onSettingChange: updateSetting,
    onLoad: load,
    onShortcutChange: setShortcut,
    onSaveShortcuts: saveShortcuts,
    onResetShortcuts: resetShortcuts,
    onRemoveOpenWithAssociation: removeOpenWithAssociation,
    shortcuts: shortcuts?.bindings ?? [],
    openWithAssociations,
    app,
  };

  const ActiveComponent = entry.Component;

  return (
    <DesktopSettingsFrame
      activeId={activeSection}
      ariaLabel="Settings"
      items={navItems}
      navigationLabel="Settings sections"
      onClose={props.onClose}
      onSelect={setActiveSection}
      presentation={props.presentation}
      title={entry.label}
    >
      <ActiveComponent {...controlProps} />
    </DesktopSettingsFrame>
  );
});

export default SettingsWorkspace;
export type { SettingValue, SettingsSection } from "./settingsTypes";
