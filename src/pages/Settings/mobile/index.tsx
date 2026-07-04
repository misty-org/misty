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
import { useAppStore } from "../../../stores/useAppStore";
import {
  settingsIndexToThemeMode,
  themeModeToSettingsIndex,
  useAppThemeStore,
} from "../../../stores/useAppThemeStore";
import { mobileErrorClass, mobilePageClass, mobileSuccessClass } from "../../../shared/mobileStyles";
import { useSettingsStore } from "../../../stores/useSettingsStore";

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
    <section className={`${mobilePageClass} scroll-smooth`}>
      {error ? <div className={mobileErrorClass}>{error}</div> : null}
      {message ? <div className={mobileSuccessClass}>{message}</div> : null}

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
        <Link
          className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm font-bold text-[var(--misty-text)] no-underline transition-colors hover:bg-[var(--misty-surface-hover)]"
          to="/account"
        >
          Open account
        </Link>
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
    <section id={`mobile-settings-${props.id}`} className="mb-[18px] min-w-0 scroll-mt-[calc(18px+var(--misty-safe-top))]">
      <header className="mb-2.5 flex items-center justify-start gap-2">
        <Icon size={20} strokeWidth={1.8} />
        <h3 className="m-0 text-[22px] font-black leading-tight text-[var(--misty-text)]">{props.title}</h3>
      </header>
      <div className="grid gap-0">{props.children}</div>
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
    <label className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 border-b border-[var(--misty-border-soft)] bg-transparent px-0 py-2 text-[#eef3fb]">
      <span className="min-w-0 truncate text-sm font-bold text-[var(--misty-text)]">{props.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        className="h-7 w-12 rounded-full border border-white/15 bg-[#101720] p-0.5 disabled:opacity-55"
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
      >
        <span
          className={[
            "grid h-[22px] w-[22px] place-items-center rounded-full text-[#071018] transition-[transform,background] duration-[160ms] ease-out",
            props.checked ? "translate-x-5 bg-[#eef3fb]" : "translate-x-0 bg-[#6f7a87]",
          ].join(" ")}
        >
          {props.checked ? <Check size={13} strokeWidth={2.5} /> : null}
        </span>
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
    <label className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 border-b border-[var(--misty-border-soft)] bg-transparent px-0 py-2 text-[#eef3fb]">
      <span className="min-w-0 truncate text-sm font-bold text-[var(--misty-text)]">{props.label}</span>
      <span className="grid min-w-[132px] grid-cols-[minmax(0,1fr)_16px] items-center gap-1.5 rounded-xl border border-white/10 bg-transparent px-2.5">
        <select
          className="min-h-[34px] min-w-0 appearance-none border-0 bg-transparent text-[13px] text-[#eef3fb] outline-none disabled:opacity-55"
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
    <div className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 border-b border-[var(--misty-border-soft)] bg-transparent px-0 py-2 text-[#eef3fb]">
      <span className="min-w-0 truncate text-sm font-bold text-[var(--misty-text)]">{props.label}</span>
      <strong className={`min-w-0 max-w-[58vw] truncate text-right text-[13px] font-bold ${props.muted ? "text-[#8792a0]" : "text-[#dbe5f0]"}`}>
        {props.value}
      </strong>
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

export default MobileSettingsPage;
