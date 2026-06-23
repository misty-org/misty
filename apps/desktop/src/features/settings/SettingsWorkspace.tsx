import { memo, type ChangeEvent, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  Bell,
  Check,
  ChevronDown,
  Eye,
  Keyboard,
  Lock,
  RefreshCcw,
  Rows3,
  Settings2,
  Trash2,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "../../app/useAppStore";
import {
  settingsIndexToThemeMode,
  themeModeToSettingsIndex,
  useAppThemeStore,
} from "../../app/useAppThemeStore";
import type { OpenWithAssociation, ShortcutBinding } from "../../api/types";
import {
  fontLabelFromPath,
  selectCustomFontPreferences,
  useSettingsStore,
  type CustomFontPreference,
} from "./useSettingsStore";

type SettingsSection = "general" | "appearance" | "account" | "privacy" | "sync" | "notifications" | "shortcuts" | "advanced";
type SettingValue = string | number | boolean | Array<Record<string, unknown>>;

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { id: "general", label: "General", icon: Rows3 },
  { id: "appearance", label: "Appearance", icon: Eye },
  { id: "account", label: "Account", icon: UserCircle },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "sync", label: "Sync", icon: RefreshCcw },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "advanced", label: "Advanced", icon: Settings2 },
];

const startupViewOptions = ["Files", "Providers", "Activity", "Transfers", "Plugins", "Hub", "Settings"];
const releaseChannelOptions = ["Stable"];
const defaultFileActionOptions = ["Open", "Preview", "Show Details"];
const transferBehaviorOptions = ["Ask Every Time", "Use Default Location"];
const themeOptions = ["System", "Dark", "Light"];
const scaleOptions = ["Small", "Default", "Large"];
const keymapOptions = ["System", "VS Code", "Finder"];
const conflictOptions = ["Keep Newest", "Ask Me", "Keep Both"];

export const SettingsWorkspace = memo(function SettingsWorkspace() {
  const {
    activeSection,
    settings,
    openWithAssociations,
    shortcuts,
    working,
    setActiveSection,
    updateSetting,
    load,
    removeOpenWithAssociation,
    setShortcut,
    saveShortcuts,
  } = useSettingsStore(useShallow((state) => ({
    activeSection: state.activeSection,
    settings: state.settings,
    openWithAssociations: state.openWithAssociations,
    shortcuts: state.shortcuts,
    working: state.working,
    setActiveSection: state.setActiveSection,
    updateSetting: state.updateSetting,
    load: state.load,
    removeOpenWithAssociation: state.removeOpenWithAssociation,
    setShortcut: state.setShortcut,
    saveShortcuts: state.saveShortcuts,
  })));
  const app = useAppStore((state) => state.app);
  const document = settings?.document ?? {};
  const title = navItems.find((item) => item.id === activeSection)?.label ?? "General";

  const controlProps = {
    document,
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
    <section className="settings-grid" aria-label="Settings">
      <aside className="settings-sidebar" aria-label="Settings sections">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item ${activeSection === item.id ? "selected" : ""}`}
              onClick={() => setActiveSection(item.id)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </aside>
      <div className="settings-divider" />
      <main className="settings-content">
        <div className="settings-scroll-surface">
          <h1>{title}</h1>
          {activeSection === "general" ? <GeneralSettings {...controlProps} /> : null}
          {activeSection === "appearance" ? <AppearanceSettings {...controlProps} /> : null}
          {activeSection === "account" ? <AccountSettings {...controlProps} /> : null}
          {activeSection === "privacy" ? <PrivacySettings {...controlProps} /> : null}
          {activeSection === "sync" ? <SyncSettings {...controlProps} /> : null}
          {activeSection === "notifications" ? <NotificationsSettings {...controlProps} /> : null}
          {activeSection === "shortcuts" ? <ShortcutsSettings {...controlProps} /> : null}
          {activeSection === "advanced" ? <AdvancedSettings {...controlProps} /> : null}
        </div>
      </main>
    </section>
  );
});

interface SettingsContentProps {
  document: Record<string, unknown>;
  working: boolean;
  onSettingChange: (section: string, key: string, value: SettingValue) => void;
  onLoad: () => Promise<void>;
  onShortcutChange: (commandId: string, shortcut: string) => void;
  onSaveShortcuts: () => Promise<void>;
  onRemoveOpenWithAssociation: (key: string) => Promise<void>;
  shortcuts: ShortcutBinding[];
  openWithAssociations: OpenWithAssociation[];
  app: ReturnType<typeof useAppStore.getState>["app"];
}

function GeneralSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Startup">
        <SettingsRow label="Default landing view" description="Choose which screen Misty should open first.">
          <SelectControl
            value={numberSetting(props.document, "general", "startup_view_index", 0)}
            options={startupViewOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "startup_view_index", value)}
          />
        </SettingsRow>
        <SettingsRow label="Reopen last session" description="Restore the last location and context when Misty launches.">
          <SwitchControl
            checked={booleanSetting(props.document, "general", "reopen_last_session", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "reopen_last_session", value)}
          />
        </SettingsRow>
        <SettingsRow label="Launch on login" description="Start Misty automatically when you sign in to this device." last>
          <SwitchControl
            checked={booleanSetting(props.document, "general", "launch_on_login", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "launch_on_login", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Updates">
        <SettingsRow label="Release channel" description="Choose which update track this installation should follow.">
          <SelectControl
            value={numberSetting(props.document, "general", "release_channel_index", 0)}
            options={releaseChannelOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "release_channel_index", value)}
          />
        </SettingsRow>
        <SettingsRow label="Auto-update" description="Download and apply updates automatically when available.">
          <SwitchControl
            checked={booleanSetting(props.document, "general", "auto_update_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "auto_update_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="Check for updates" description="Run an explicit update check right now." last>
          <div className="settings-action-stack">
            <button
              type="button"
              className="settings-control-button"
              disabled={props.working}
              onClick={() => props.onSettingChange("general", "last_update_check_label", "Just now")}
            >
              Check now
            </button>
            <div className="settings-meta">
              <strong>{stringSetting(props.document, "general", "last_update_check_label", "Never checked")}</strong>
              <span>Last checked</span>
            </div>
          </div>
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Behavior">
        <SettingsRow label="Confirm destructive actions" description="Ask before delete, empty trash, and other irreversible actions.">
          <SwitchControl
            checked={booleanSetting(props.document, "general", "confirm_destructive_actions", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "confirm_destructive_actions", value)}
          />
        </SettingsRow>
        <SettingsRow label="Default file action" description="Choose what a primary file interaction should do.">
          <SelectControl
            value={numberSetting(props.document, "general", "default_file_action_index", 0)}
            options={defaultFileActionOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "default_file_action_index", value)}
          />
        </SettingsRow>
        <SettingsRow label="Open links externally" description="Send external links to the system browser instead of handling them in-app." last>
          <SwitchControl
            checked={booleanSetting(props.document, "general", "open_links_externally", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "open_links_externally", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="System">
        <SettingsRow label="Proxy URL" description="The configured local proxy endpoint Misty uses for provider requests.">
          <ValueText value={props.app?.environment.proxyUrl ?? "Not configured"} muted={!props.app?.environment.proxyUrl} />
        </SettingsRow>
        <SettingsRow label="App version" description="The installed Misty build version.">
          <ValueText value="v0.1.0-beta" />
        </SettingsRow>
        <SettingsRow label="Build info" description="Helpful runtime details for troubleshooting and support.">
          <ValueText value="Tauri desktop shell" muted />
        </SettingsRow>
        <SettingsRow label="Config path" description="Where Misty stores local configuration files on this device.">
          <ValueText value={props.app?.environment.configDir ?? "Loading"} />
        </SettingsRow>
        <SettingsRow label="Data path" description="Where Misty stores local app data on this device." last>
          <ValueText value={props.app?.environment.mistyDir ?? "Loading"} />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Defaults">
        <SettingsRow label="Preferred workspace root" description="Choose the default starting location for file browsing.">
          <TextControl
            value={stringSetting(props.document, "general", "preferred_workspace_root", "")}
            placeholder="Default"
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("general", "preferred_workspace_root", value)}
          />
        </SettingsRow>
        <SettingsRow label="Mount path" description="Set the default Misty mount location used for local file access.">
          <TextControl
            value={stringSetting(props.document, "advanced", "mount_path", ".misty/mnt")}
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("advanced", "mount_path", value)}
          />
        </SettingsRow>
        <SettingsRow label="Default transfer behavior" description="Choose how copy and download flows should behave by default." last>
          <SelectControl
            value={numberSetting(props.document, "general", "default_transfer_behavior_index", 0)}
            options={transferBehaviorOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "default_transfer_behavior_index", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function AppearanceSettings(props: SettingsContentProps) {
  const themeMode = useAppThemeStore((state) => state.themeMode);
  const setThemeMode = useAppThemeStore((state) => state.setThemeMode);
  const themeIndex = themeModeToSettingsIndex(themeMode);
  const customFonts = selectCustomFontPreferences(props.document);
  const updateCustomFonts = (fonts: CustomFontPreference[]) => {
    props.onSettingChange("appearance", "custom_fonts", fonts.map((font) => ({ label: font.label, path: font.path })));
  };
  const addCustomFont = async () => {
    const selection = await open({
      title: "Select Font",
      multiple: false,
      directory: false,
      filters: [{ name: "Fonts", extensions: ["ttf", "otf"] }],
    });
    const path = Array.isArray(selection) ? selection[0] : selection;
    if (!path) return;
    const existing = new Set(customFonts.map((font) => font.path));
    if (existing.has(path)) return;
    updateCustomFonts([...customFonts, { label: fontLabelFromPath(path), path }]);
  };
  const removeCustomFont = (index: number) => {
    updateCustomFonts(customFonts.filter((_, fontIndex) => fontIndex !== index));
  };

  return (
    <>
      <SettingsSectionBlock title="Theme">
        <SettingsRow label="Theme mode" description="Choose whether Misty follows the system appearance or uses a fixed theme.">
          <SelectControl
            value={themeIndex}
            options={themeOptions}
            disabled={props.working}
            onChange={(value) => {
              setThemeMode(settingsIndexToThemeMode(value));
              props.onSettingChange("appearance", "theme_index", value);
            }}
          />
        </SettingsRow>
        <SettingsRow label="UI scale" description="Adjust overall interface scale and density." last>
          <SelectControl
            value={numberSetting(props.document, "appearance", "ui_scale_index", 1)}
            options={scaleOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "ui_scale_index", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Layout">
        <SettingsRow label="Compact mode" description="Reduce padding and spacing in file-heavy views." last>
          <SwitchControl
            checked={booleanSetting(props.document, "appearance", "compact_mode_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "compact_mode_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Typography">
        <SettingsRow label="Font size" description="Choose the baseline text size Misty should use." last>
          <SelectControl
            value={numberSetting(props.document, "appearance", "font_size_index", 1)}
            options={scaleOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "font_size_index", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Fonts">
        <SettingsNote>Add custom fallback fonts to support filenames and text in additional languages.</SettingsNote>
        <div className="settings-reference-list settings-font-list">
          <div className="settings-reference-row header">
            <span>Label</span>
            <span>Path</span>
            <span />
          </div>
          {customFonts.map((font, index) => (
            <div className="settings-reference-row" key={`${font.path}:${index}`}>
              <span>{font.label || fontLabelFromPath(font.path)}</span>
              <span title={font.path}>{font.path}</span>
              <button
                type="button"
                className="settings-icon-danger"
                aria-label={`Remove ${font.label || font.path}`}
                disabled={props.working}
                onClick={() => removeCustomFont(index)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {customFonts.length === 0 ? <p className="settings-empty">No custom fonts added yet.</p> : null}
        </div>
        <div className="settings-inline-actions">
          <button type="button" className="settings-control-button compact" disabled={props.working} onClick={() => void addCustomFont()}>
            Add Font
          </button>
        </div>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Media">
        <SettingsRow label="Thumbnail previews" description="Show preview-rich file rows where supported.">
          <SwitchControl
            checked={booleanSetting(props.document, "appearance", "thumbnail_previews_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "thumbnail_previews_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="Reduced motion" description="Tone down motion and animated transitions." last>
          <SwitchControl
            checked={booleanSetting(props.document, "appearance", "reduced_motion_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "reduced_motion_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function AccountSettings(props: SettingsContentProps) {
  const email = stringSetting(props.document, "account", "email", "");
  const plan = stringSetting(props.document, "account", "subscription_plan_label", "Free");
  const providerCount = numberSetting(props.document, "account", "connected_provider_count", 0);

  return (
    <>
      <SettingsSectionBlock title="Profile">
        <SettingsRow label="Signed in as" description="The account Misty uses for Hub, licensing, and product services.">
          <ValueText value={email || "Not signed in"} muted={!email} />
        </SettingsRow>
        <SettingsRow label="Subscription" description="The currently cached product plan for this installation.">
          <ValueText value={plan || "Free"} muted={!plan || plan === "Free"} />
        </SettingsRow>
        <SettingsRow label="Connected providers" description="Provider connections associated with this local Misty profile." last>
          <ValueText value={String(providerCount)} muted={providerCount === 0} />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Management">
        <SettingsRow label="Misty Hub account" description="Open the embedded Hub account area for sign-in, licensing, and profile controls." last>
          <Link className="settings-control-button settings-link-button" to="/hub/account">
            Open Account
          </Link>
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function PrivacySettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Data Handling">
        <SettingsRow label="Process data locally" description="Keep file handling and provider orchestration local whenever possible.">
          <SwitchControl
            checked={booleanSetting(props.document, "privacy", "local_processing_only", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("privacy", "local_processing_only", value)}
          />
        </SettingsRow>
        <SettingsRow label="Share diagnostics" description="Allow Misty to include low-level runtime details when exporting diagnostics." last>
          <SwitchControl
            checked={booleanSetting(props.document, "privacy", "diagnostics_sharing_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("privacy", "diagnostics_sharing_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Exports & Deletion">
        <SettingsRow label="Allow data export" description="Keep account export actions available in privacy and support workflows." last>
          <SwitchControl
            checked={booleanSetting(props.document, "privacy", "export_data_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("privacy", "export_data_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Legal">
        <SettingsRow label="Privacy Policy" description="Review how Misty handles account and runtime data.">
          <ValueText value="Available soon" muted />
        </SettingsRow>
        <SettingsRow label="Terms of Service" description="Review product terms before release packaging." last>
          <ValueText value="Available soon" muted />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function SyncSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Status">
        <SettingsRow label="Auto-sync" description="Keep Misty in sync without requiring manual refreshes.">
          <SwitchControl
            checked={booleanSetting(props.document, "sync", "auto_sync_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("sync", "auto_sync_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="Version history" description="Keep enough state around to recover from accidental overwrites." last>
          <SwitchControl
            checked={booleanSetting(props.document, "sync", "version_history_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("sync", "version_history_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Rules">
        <SettingsRow label="Sync on launch" description="Check for sync activity automatically when Misty starts.">
          <SwitchControl
            checked={booleanSetting(props.document, "sync", "sync_on_launch_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("sync", "sync_on_launch_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="Sync on quit" description="Attempt a final sync pass before Misty closes.">
          <SwitchControl
            checked={booleanSetting(props.document, "sync", "sync_on_quit_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("sync", "sync_on_quit_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="Allow metered sync" description="Continue syncing when the network may have bandwidth limits." last>
          <SwitchControl
            checked={booleanSetting(props.document, "sync", "allow_metered_sync", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("sync", "allow_metered_sync", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Conflict Resolution">
        <SettingsRow label="Default strategy" description="Choose how Misty should behave when the same file changes in two places." last>
          <SelectControl
            value={numberSetting(props.document, "sync", "conflict_resolution_index", 0)}
            options={conflictOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("sync", "conflict_resolution_index", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function NotificationsSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Activity Alerts">
        <SettingsRow label="Desktop notifications" description="Show system-level notifications for important events.">
          <SwitchControl
            checked={booleanSetting(props.document, "notifications", "desktop_notifications_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("notifications", "desktop_notifications_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="In-app toasts" description="Show transient notifications inside Misty.">
          <SwitchControl
            checked={booleanSetting(props.document, "notifications", "in_app_notifications_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("notifications", "in_app_notifications_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="Play sounds" description="Use sound for completion and error alerts." last>
          <SwitchControl
            checked={booleanSetting(props.document, "notifications", "sound_notifications_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("notifications", "sound_notifications_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="System Notifications">
        <SettingsRow label="Badge count" description="Show pending activity counts where the platform supports it." last>
          <SwitchControl
            checked={booleanSetting(props.document, "notifications", "badge_count_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("notifications", "badge_count_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Digest & Quiet Hours">
        <SettingsRow label="Quiet hours" description="Suppress non-critical notifications during focus time.">
          <SwitchControl
            checked={booleanSetting(props.document, "notifications", "quiet_hours_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("notifications", "quiet_hours_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="Notification digest" description="Bundle lower-priority updates into a lighter summary." last>
          <SwitchControl
            checked={booleanSetting(props.document, "notifications", "digest_notifications_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("notifications", "digest_notifications_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function ShortcutsSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Navigation">
        <SettingsRow label="Show shortcut hints" description="Display shortcut hints in tooltips and menus where helpful." last>
          <SwitchControl
            checked={booleanSetting(props.document, "shortcuts", "shortcut_hints_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("shortcuts", "shortcut_hints_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Customization">
        <SettingsRow label="Keymap preset" description="Choose the shortcut style that feels most natural on this device.">
          <SelectControl
            value={numberSetting(props.document, "shortcuts", "keymap_index", 0)}
            options={keymapOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("shortcuts", "keymap_index", value)}
          />
        </SettingsRow>
        <SettingsRow label="Enable custom shortcuts" description="Use saved per-command shortcut overrides instead of only Misty's built-in defaults." last>
          <SwitchControl
            checked={booleanSetting(props.document, "shortcuts", "custom_shortcuts_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("shortcuts", "custom_shortcuts_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Reference">
        <SettingsNote>Review the active bindings Misty has loaded so shortcut behavior is easy to test.</SettingsNote>
        <div className="settings-reference-list">
          <div className="settings-reference-row header">
            <span>Command</span>
            <span>Shortcut</span>
          </div>
          {props.shortcuts.map((binding) => (
            <div className="settings-reference-row" key={binding.commandId}>
              <span>{binding.commandId}</span>
              <input
                value={binding.shortcut}
                disabled={props.working}
                onChange={(event) => props.onShortcutChange(binding.commandId, event.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="settings-inline-actions">
          <button type="button" className="settings-primary-button" disabled={props.working} onClick={() => void props.onSaveShortcuts()}>
            Save Changes
          </button>
          <button type="button" className="settings-control-button compact" disabled={props.working} onClick={() => void props.onLoad()}>
            Reset
          </button>
        </div>
      </SettingsSectionBlock>
    </>
  );
}

function AdvancedSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Diagnostics">
        <SettingsRow label="Loaded views" description="Top-level views currently instantiated in memory.">
          <ValueText value="Tauri route shell" muted />
        </SettingsRow>
        <SettingsRow label="Debug logging" description="Keep more verbose runtime details available while polishing the release.">
          <SwitchControl
            checked={booleanSetting(props.document, "advanced", "debug_logging_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("advanced", "debug_logging_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="Experimental features" description="Allow in-progress features to surface before they are fully settled.">
          <SwitchControl
            checked={booleanSetting(props.document, "advanced", "experimental_features_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("advanced", "experimental_features_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="Frame pacing overlay" description="Show the live idle, light, and heavy pacing state in the top-right corner." last>
          <SwitchControl
            checked={booleanSetting(props.document, "advanced", "frame_pacing_overlay_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("advanced", "frame_pacing_overlay_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Connection">
        <SettingsRow label="Server address" description="The gRPC address Misty uses for local file operations.">
          <TextControl
            value={stringSetting(props.document, "advanced", "server_address", "localhost:50051")}
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("advanced", "server_address", value)}
          />
        </SettingsRow>
        <SettingsRow label="Mount path" description="The root path Misty should treat as its default mount target." last>
          <TextControl
            value={stringSetting(props.document, "advanced", "mount_path", ".misty/mnt")}
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("advanced", "mount_path", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Open With Associations">
        <SettingsNote>Review remembered apps used by File Explorer.</SettingsNote>
        <div className="settings-reference-list associations">
          <div className="settings-reference-row header">
            <span>File</span>
            <span>Application</span>
            <span />
          </div>
          {props.openWithAssociations.map((association) => (
            <div className="settings-reference-row" key={association.key}>
              <span>{association.key}</span>
              <span title={association.applicationPath}>{association.applicationPath}</span>
              <button
                type="button"
                className="settings-icon-danger"
                aria-label={`Remove ${association.key}`}
                disabled={props.working}
                onClick={() => void props.onRemoveOpenWithAssociation(association.key)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {props.openWithAssociations.length === 0 ? <p className="settings-empty">No Open With associations saved.</p> : null}
        </div>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Safeguards">
        <SettingsRow label="Confirm clear recent" description="Ask before clearing the recent-items list.">
          <SwitchControl
            checked={booleanSetting(props.document, "advanced", "confirm_clear_recent", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("advanced", "confirm_clear_recent", value)}
          />
        </SettingsRow>
        <SettingsRow label="Confirm clear starred" description="Ask before clearing starred items in bulk.">
          <SwitchControl
            checked={booleanSetting(props.document, "advanced", "confirm_clear_starred", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("advanced", "confirm_clear_starred", value)}
          />
        </SettingsRow>
        <SettingsRow label="Confirm empty trash" description="Require confirmation before emptying trash.">
          <SwitchControl
            checked={booleanSetting(props.document, "advanced", "confirm_empty_trash", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("advanced", "confirm_empty_trash", value)}
          />
        </SettingsRow>
        <SettingsRow label="Confirm clear cache" description="Ask before clearing runtime caches and temporary data." last>
          <SwitchControl
            checked={booleanSetting(props.document, "advanced", "confirm_clear_cache", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("advanced", "confirm_clear_cache", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

function SettingsSectionBlock(props: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{props.title}</h2>
      <div className="settings-section-divider" />
      {props.children}
    </section>
  );
}

function SettingsRow(props: { label: string; description: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={`settings-row ${props.last ? "last" : ""}`}>
      <div className="settings-row-copy">
        <strong>{props.label}</strong>
        <span>{props.description}</span>
      </div>
      <div className="settings-row-control">{props.children}</div>
    </div>
  );
}

function SettingsNote(props: { children: ReactNode }) {
  return <p className="settings-note">{props.children}</p>;
}

function SelectControl(props: {
  value: number;
  options: string[];
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-select">
      <select
        value={Math.min(props.value, props.options.length - 1)}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.target.value))}
      >
        {props.options.map((option, index) => (
          <option key={option} value={index}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown size={18} />
    </label>
  );
}

function SwitchControl(props: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      className={`settings-switch ${props.checked ? "on" : ""}`}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span>{props.checked ? <Check size={14} strokeWidth={2.5} /> : null}</span>
    </button>
  );
}

function TextControl(props: {
  value: string;
  placeholder?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const handleCommit = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.value !== props.value) {
      props.onCommit(event.currentTarget.value);
    }
  };

  return (
    <input
      key={props.value}
      className="settings-text-control"
      defaultValue={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onBlur={handleCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ValueText(props: { value: string; muted?: boolean }) {
  return <span className={`settings-value-text ${props.muted ? "muted" : ""}`}>{props.value}</span>;
}

function sectionRecord(document: Record<string, unknown>, section: string): Record<string, unknown> {
  const value = document[section];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberSetting(document: Record<string, unknown>, section: string, key: string, fallback: number): number {
  const value = sectionRecord(document, section)[key];
  return typeof value === "number" ? value : fallback;
}

function booleanSetting(document: Record<string, unknown>, section: string, key: string, fallback: boolean): boolean {
  const value = sectionRecord(document, section)[key];
  return typeof value === "boolean" ? value : fallback;
}

function stringSetting(document: Record<string, unknown>, section: string, key: string, fallback: string): string {
  const value = sectionRecord(document, section)[key];
  return typeof value === "string" ? value : fallback;
}
