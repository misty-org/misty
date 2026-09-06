import { useAppStore } from "@/features/app-shell";
import { useSettingsStore } from "./store/useSettingsStore";
import {
  Bell,
  Bot,
  MonitorCog,
  SlidersHorizontal,
  Blocks,
  Cpu,
  DownloadCloud,
  Eye,
  Keyboard,
  LifeBuoy,
  Lock,
  MessageCircle,
  Rows3,
  Server,
  Settings2,
} from "lucide-react";
import { memo, type ComponentType } from "react";
import { ComingSoonSurface } from "@/shared/ui";
import { useShallow } from "zustand/react/shallow";
import { DesktopSettingsFrame } from "./components/DesktopSettingsUI";
import { AdvancedSection } from "./sections/AdvancedSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { GeneralSection } from "./sections/GeneralSection";
import { MistySection } from "./sections/MistySection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { PrivacySection } from "./sections/PrivacySection";
import { ServerSection } from "./sections/ServerSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { UpdatesSection } from "./sections/UpdatesSection";
import { SupportRecoverySection } from "@/features/support";
import type { SettingsContentProps, SettingsSection } from "./settingsTypes";
import type { LucideIcon } from "lucide-react";

/**
 * The one place a section is declared.
 *
 * `group` captions the nav rail. Sixteen entries need the break, and the
 * caption is what tells you whether a section configures preferences, an app,
 * or the underlying system.
 */
export type SettingsGroup = "preferences" | "agents" | "system";

/** Rail captions, drawn with the global navigator's section-header treatment. */
const groupLabels: Record<SettingsGroup, string> = {
  preferences: "Preferences",
  agents: "Agents",
  system: "System",
};

const groupIcons: Record<SettingsGroup, LucideIcon> = {
  preferences: SlidersHorizontal,
  agents: Bot,
  system: MonitorCog,
};

export interface SettingsRegistryEntry {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: SettingsGroup;
  Component: ComponentType<SettingsContentProps>;
}

const ModelsComingSoonSection = () => <SettingsComingSoon feature="Models" />;
const ExtensionsComingSoonSection = () => <SettingsComingSoon feature="Extensions" />;

function SettingsComingSoon({ feature }: { feature: string }) {
  return (
    <ComingSoonSurface
      feature={feature}
      className="min-h-[360px] rounded-lg border border-charcoal-border/80 bg-charcoal-card"
    />
  );
}

export const settingsRegistry: readonly SettingsRegistryEntry[] = [
  {
    id: "general",
    label: "General",
    icon: Rows3,
    group: "preferences",
    Component: GeneralSection,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Eye,
    group: "preferences",
    Component: AppearanceSection,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    group: "preferences",
    Component: NotificationsSection,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: Keyboard,
    group: "preferences",
    Component: ShortcutsSection,
  },
  {
    id: "models",
    label: "Models",
    icon: Cpu,
    group: "agents",
    Component: ModelsComingSoonSection,
  },
  {
    id: "misty",
    label: "Misty",
    icon: MessageCircle,
    group: "agents",
    Component: MistySection,
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: Blocks,
    group: "system",
    Component: ExtensionsComingSoonSection,
  },
  {
    id: "server",
    label: "Server",
    icon: Server,
    group: "system",
    Component: ServerSection,
  },
  {
    id: "privacy",
    label: "Privacy",
    icon: Lock,
    group: "system",
    Component: PrivacySection,
  },
  {
    id: "updates",
    label: "Updates",
    icon: DownloadCloud,
    group: "system",
    Component: UpdatesSection,
  },
  {
    id: "support",
    label: "Help",
    icon: LifeBuoy,
    group: "system",
    Component: SupportRecoverySection,
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
  groupIcon: groupIcons[group],
}));

const mobileExcludedSettings = new Set<SettingsSection>([
  "shortcuts",
  "code",
  "terminal",
  "transfers",
  "extensions",
  "server",
  "updates",
  "advanced",
]);

export const SettingsWorkspace = memo(function SettingsWorkspace(props: {
  presentation?: "page" | "overlay" | "mobile";
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
    updateShortcut,
    reassignShortcut,
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
      updateShortcut: state.updateShortcut,
      reassignShortcut: state.reassignShortcut,
      resetShortcuts: state.resetShortcuts,
    })),
  );
  const app = useAppStore((state) => state.app);
  const document = settings?.document ?? {};
  const mobile = props.presentation === "mobile";
  const visibleRegistry = mobile
    ? settingsRegistry.filter((item) => !mobileExcludedSettings.has(item.id))
    : settingsRegistry;
  const visibleNavItems = mobile
    ? navItems.filter((item) => !mobileExcludedSettings.has(item.id))
    : navItems;
  const entry = visibleRegistry.find((item) => item.id === activeSection) ?? visibleRegistry[0];
  const visibleActiveSection = entry.id;
  const controlProps: SettingsContentProps = {
    document,
    launchOnLogin,
    working,
    onSettingChange: updateSetting,
    onLoad: load,
    onShortcutChange: updateShortcut,
    onShortcutReassign: reassignShortcut,
    onResetShortcuts: resetShortcuts,
    onRemoveOpenWithAssociation: removeOpenWithAssociation,
    shortcuts,
    openWithAssociations,
    app,
  };

  const ActiveComponent = entry.Component;

  return (
    <DesktopSettingsFrame
      activeId={visibleActiveSection}
      ariaLabel="Settings"
      items={visibleNavItems}
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
