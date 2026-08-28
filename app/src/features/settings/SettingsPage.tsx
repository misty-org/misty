import { useAppStore } from "@/features/app-shell";
import { workspaceAppIconColorClass } from "@/features/workspace";
import { useSettingsStore } from "./store/useSettingsStore";
import {
  ArrowLeftRight,
  Bell,
  BookOpenText,
  Bot,
  Blocks,
  CheckSquare2,
  Code,
  Cpu,
  DownloadCloud,
  Eye,
  FolderOpen,
  Globe,
  Inbox,
  Keyboard,
  LifeBuoy,
  Lock,
  MessageCircle,
  MessagesSquare,
  Notebook,
  Rows3,
  Search,
  Server,
  Settings2,
  SquareTerminal,
} from "lucide-react";
import { memo, type ComponentType } from "react";
import { ComingSoonSurface } from "@/shared/ui";
import { useShallow } from "zustand/react/shallow";
import { DesktopSettingsFrame } from "./components/DesktopSettingsUI";
import { AdvancedSection } from "./sections/AdvancedSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { BrowserSection } from "./sections/BrowserSection";
import { CodeSection } from "./sections/CodeSection";
import { FilesSection } from "./sections/FilesSection";
import { GeneralSection } from "./sections/GeneralSection";
import { MistySection } from "./sections/MistySection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { PrivacySection } from "./sections/PrivacySection";
import { SearchSection } from "./sections/SearchSection";
import { ServerSection } from "./sections/ServerSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { TerminalSection } from "./sections/TerminalSection";
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
export type SettingsGroup = "preferences" | "apps" | "agents" | "system";

/** Rail captions, drawn with the global navigator's section-header treatment. */
const groupLabels: Record<SettingsGroup, string> = {
  preferences: "Preferences",
  apps: "Apps",
  agents: "Agents",
  system: "System",
};

export interface SettingsRegistryEntry {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  group: SettingsGroup;
  Component: ComponentType<SettingsContentProps>;
}

const TransfersComingSoonSection = () => <SettingsComingSoon feature="Transfers" />;
const InboxComingSoonSection = () => <SettingsComingSoon feature="Inbox" />;
const SocialComingSoonSection = () => <SettingsComingSoon feature="Social" />;
const JournalComingSoonSection = () => <SettingsComingSoon feature="Journal" />;
const PlannerComingSoonSection = () => <SettingsComingSoon feature="Planner" />;
const LibraryComingSoonSection = () => <SettingsComingSoon feature="Library" />;
const ModelsComingSoonSection = () => <SettingsComingSoon feature="Models" />;
const AgentsComingSoonSection = () => <SettingsComingSoon feature="Agents" />;
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
    iconClassName: "text-avatar-aqua",
    group: "preferences",
    Component: GeneralSection,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Eye,
    iconClassName: "text-agent-violet",
    group: "preferences",
    Component: AppearanceSection,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    iconClassName: "text-agent-amber",
    group: "preferences",
    Component: NotificationsSection,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: Keyboard,
    iconClassName: "text-agent-blue",
    group: "preferences",
    Component: ShortcutsSection,
  },
  {
    id: "search",
    label: "Search",
    icon: Search,
    iconClassName: "text-agent-indigo",
    group: "preferences",
    Component: SearchSection,
  },

  {
    id: "inbox",
    label: "Inbox",
    icon: Inbox,
    iconClassName: workspaceAppIconColorClass("inbox"),
    group: "apps",
    Component: InboxComingSoonSection,
  },
  {
    id: "social",
    label: "Social",
    icon: MessagesSquare,
    iconClassName: workspaceAppIconColorClass("social"),
    group: "apps",
    Component: SocialComingSoonSection,
  },
  {
    id: "journal",
    label: "Journal",
    icon: Notebook,
    iconClassName: workspaceAppIconColorClass("journal"),
    group: "apps",
    Component: JournalComingSoonSection,
  },
  {
    id: "files",
    label: "Files",
    icon: FolderOpen,
    iconClassName: workspaceAppIconColorClass("files"),
    group: "apps",
    Component: FilesSection,
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
    iconClassName: workspaceAppIconColorClass("agents"),
    group: "apps",
    Component: AgentsComingSoonSection,
  },
  {
    id: "planner",
    label: "Planner",
    icon: CheckSquare2,
    iconClassName: workspaceAppIconColorClass("planner"),
    group: "apps",
    Component: PlannerComingSoonSection,
  },
  {
    id: "library",
    label: "Library",
    icon: BookOpenText,
    iconClassName: workspaceAppIconColorClass("library"),
    group: "apps",
    Component: LibraryComingSoonSection,
  },
  {
    id: "browser",
    label: "Browser",
    icon: Globe,
    iconClassName: workspaceAppIconColorClass("browser"),
    group: "apps",
    Component: BrowserSection,
  },
  {
    id: "code",
    label: "Code",
    icon: Code,
    iconClassName: workspaceAppIconColorClass("code"),
    group: "apps",
    Component: CodeSection,
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
    iconClassName: workspaceAppIconColorClass("terminal"),
    group: "apps",
    Component: TerminalSection,
  },
  {
    id: "models",
    label: "Models",
    icon: Cpu,
    iconClassName: "text-agent-blue",
    group: "agents",
    Component: ModelsComingSoonSection,
  },
  {
    id: "misty",
    label: "Misty",
    icon: MessageCircle,
    iconClassName: "text-agent-rose",
    group: "agents",
    Component: MistySection,
  },
  {
    id: "transfers",
    label: "Transfers",
    icon: ArrowLeftRight,
    iconClassName: workspaceAppIconColorClass("transfers"),
    group: "system",
    Component: TransfersComingSoonSection,
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: Blocks,
    iconClassName: workspaceAppIconColorClass("marketplace"),
    group: "system",
    Component: ExtensionsComingSoonSection,
  },
  {
    id: "server",
    label: "Server",
    icon: Server,
    iconClassName: "text-avatar-green",
    group: "system",
    Component: ServerSection,
  },
  {
    id: "privacy",
    label: "Privacy",
    icon: Lock,
    iconClassName: "text-agent-indigo",
    group: "system",
    Component: PrivacySection,
  },
  {
    id: "updates",
    label: "Updates",
    icon: DownloadCloud,
    iconClassName: "text-avatar-aqua",
    group: "system",
    Component: UpdatesSection,
  },
  {
    id: "support",
    label: "Help",
    icon: LifeBuoy,
    iconClassName: "text-agent-amber",
    group: "system",
    Component: SupportRecoverySection,
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: Settings2,
    iconClassName: "text-avatar-orange",
    group: "system",
    Component: AdvancedSection,
  },
];

const navItems = settingsRegistry.map(({ id, label, icon, iconClassName, group }) => ({
  id,
  label,
  icon,
  iconClassName,
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
  const entry = settingsRegistry.find((item) => item.id === activeSection) ?? settingsRegistry[0];
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
