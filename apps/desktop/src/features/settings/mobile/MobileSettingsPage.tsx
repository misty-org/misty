import {
  Bell,
  Check,
  ChevronDown,
  Info,
  Moon,
  Shield,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../../app/useAppStore";
import {
  settingsIndexToThemeMode,
  themeModeToSettingsIndex,
  useAppThemeStore,
} from "../../../app/useAppThemeStore";
import { useSettingsStore } from "../useSettingsStore";

type SettingValue = string | number | boolean | Array<Record<string, unknown>>;

const themeOptions = ["System", "Dark", "Light"];
const scaleOptions = ["Small", "Default", "Large"];

export function MobileSettingsPage() {
  const app = useAppStore((state) => state.app);
  const {
    settings,
    working,
    error,
    message,
    load,
    updateSetting,
  } = useSettingsStore(useShallow((state) => ({
    settings: state.settings,
    working: state.working,
    error: state.error,
    message: state.message,
    load: state.load,
    updateSetting: state.updateSetting,
  })));
  const document = settings?.document ?? {};
  const themeMode = useAppThemeStore((state) => state.themeMode);
  const setThemeMode = useAppThemeStore((state) => state.setThemeMode);

  useEffect(() => {
    void load();
  }, [load]);

  const onSettingChange = (section: string, key: string, value: SettingValue) => updateSetting(section, key, value);

  return (
    <section className="mobile-page mobile-settings-page">
      {error ? <div className="mobile-error">{error}</div> : null}
      {message ? <div className="mobile-success">{message}</div> : null}

      <MobileSettingsSection id="appearance" icon={Moon} title="Appearance">
        <MobileSelectRow
          label="Theme mode"
          value={themeModeToSettingsIndex(themeMode)}
          options={themeOptions}
          disabled={working}
          onChange={(value) => {
            setThemeMode(settingsIndexToThemeMode(value));
            onSettingChange("appearance", "theme_index", value);
          }}
        />
        <MobileSelectRow label="Text size" value={numberSetting(document, "appearance", "font_size_index", 1)} options={scaleOptions} disabled={working} onChange={(value) => onSettingChange("appearance", "font_size_index", value)} />
        <MobileSwitchRow label="Thumbnail previews" checked={booleanSetting(document, "appearance", "thumbnail_previews_enabled", true)} disabled={working} onChange={(value) => onSettingChange("appearance", "thumbnail_previews_enabled", value)} />
        <MobileSwitchRow label="Reduced motion" checked={booleanSetting(document, "appearance", "reduced_motion_enabled", false)} disabled={working} onChange={(value) => onSettingChange("appearance", "reduced_motion_enabled", value)} />
      </MobileSettingsSection>

      <MobileSettingsSection id="account" icon={UserCircle} title="Account">
        <MobileValueRow label="Signed in as" value={stringSetting(document, "account", "email", "") || "Not signed in"} />
        <MobileValueRow label="Subscription" value={stringSetting(document, "account", "subscription_plan_label", "Free")} />
        <MobileValueRow label="Connected providers" value={String(numberSetting(document, "account", "connected_provider_count", 0))} />
        <Link className="mobile-secondary-action" to="/account">Open account</Link>
      </MobileSettingsSection>

      <MobileSettingsSection id="privacy" icon={Shield} title="Privacy">
        <MobileSwitchRow label="Process data locally" checked={booleanSetting(document, "privacy", "local_processing_only", true)} disabled={working} onChange={(value) => onSettingChange("privacy", "local_processing_only", value)} />
        <MobileSwitchRow label="Share diagnostics" checked={booleanSetting(document, "privacy", "diagnostics_sharing_enabled", false)} disabled={working} onChange={(value) => onSettingChange("privacy", "diagnostics_sharing_enabled", value)} />
        <MobileValueRow label="Privacy Policy" value="Available soon" muted />
        <MobileValueRow label="Terms of Service" value="Available soon" muted />
      </MobileSettingsSection>

      <MobileSettingsSection id="notifications" icon={Bell} title="Notifications">
        <MobileSwitchRow label="System notifications" checked={booleanSetting(document, "notifications", "desktop_notifications_enabled", true)} disabled={working} onChange={(value) => onSettingChange("notifications", "desktop_notifications_enabled", value)} />
        <MobileSwitchRow label="In-app toasts" checked={booleanSetting(document, "notifications", "in_app_notifications_enabled", true)} disabled={working} onChange={(value) => onSettingChange("notifications", "in_app_notifications_enabled", value)} />
        <MobileSwitchRow label="Badge count" checked={booleanSetting(document, "notifications", "badge_count_enabled", true)} disabled={working} onChange={(value) => onSettingChange("notifications", "badge_count_enabled", value)} />
        <MobileSwitchRow label="Quiet hours" checked={booleanSetting(document, "notifications", "quiet_hours_enabled", false)} disabled={working} onChange={(value) => onSettingChange("notifications", "quiet_hours_enabled", value)} />
      </MobileSettingsSection>

      <MobileSettingsSection id="about" icon={Info} title="About">
        <MobileValueRow label="App" value={app?.appName ?? "Misty"} />
        <MobileValueRow label="Version" value="v0.1.0-beta" />
        <MobileValueRow label="Build" value="Mobile shell" muted />
      </MobileSettingsSection>
    </section>
  );
}

function MobileSettingsSection(props: { id: string; icon: LucideIcon; title: string; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <section id={`mobile-settings-${props.id}`} className="mobile-panel mobile-settings-section">
      <header>
        <Icon size={20} strokeWidth={1.8} />
        <h3>{props.title}</h3>
      </header>
      <div className="mobile-settings-row-list">{props.children}</div>
    </section>
  );
}

function MobileSwitchRow(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="mobile-switch-row mobile-settings-control-row">
      <span>{props.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        className={`mobile-settings-switch ${props.checked ? "on" : ""}`}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
      >
        <span>{props.checked ? <Check size={13} strokeWidth={2.5} /> : null}</span>
      </button>
    </label>
  );
}

function MobileSelectRow(props: {
  label: string;
  value: number;
  options: string[];
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mobile-settings-control-row mobile-settings-select-row">
      <span>{props.label}</span>
      <span>
        <select
          value={Math.min(props.value, props.options.length - 1)}
          disabled={props.disabled}
          onChange={(event) => props.onChange(Number(event.target.value))}
        >
          {props.options.map((option, index) => (
            <option key={option} value={index}>{option}</option>
          ))}
        </select>
        <ChevronDown size={16} />
      </span>
    </label>
  );
}

function MobileValueRow(props: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="mobile-settings-control-row mobile-settings-value-row">
      <span>{props.label}</span>
      <strong className={props.muted ? "muted" : undefined}>{props.value}</strong>
    </div>
  );
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
