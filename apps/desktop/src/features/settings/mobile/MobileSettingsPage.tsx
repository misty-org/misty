import { Bell, Info, Moon, RefreshCcw, Shield, UserCircle } from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../../app/useAppStore";
import {
  selectNotificationPreferences,
  useSettingsStore,
} from "../useSettingsStore";

export function MobileSettingsPage() {
  const app = useAppStore((state) => state.app);
  const {
    settings,
    working,
    load,
    updateSetting,
  } = useSettingsStore(useShallow((state) => ({
    settings: state.settings,
    working: state.working,
    load: state.load,
    updateSetting: state.updateSetting,
  })));
  const notificationPreferences = selectNotificationPreferences(settings?.document);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mobile-page mobile-settings-page">
      <section className="mobile-panel">
        <header>
          <Moon size={20} strokeWidth={1.8} />
          <h3>Appearance</h3>
        </header>
        <p>Misty mobile uses a dark, touch-first interface. Desktop keeps the full appearance controls.</p>
      </section>

      <section className="mobile-panel">
        <header>
          <Bell size={20} strokeWidth={1.8} />
          <h3>Notifications</h3>
        </header>
        <MobileSwitch
          label="In-app notices"
          checked={notificationPreferences.inAppNotificationsEnabled}
          disabled={working}
          onChange={(value) => updateSetting("notifications", "in_app_notifications_enabled", value)}
        />
        <MobileSwitch
          label="Badge count"
          checked={notificationPreferences.badgeCountEnabled}
          disabled={working}
          onChange={(value) => updateSetting("notifications", "badge_count_enabled", value)}
        />
      </section>

      <section className="mobile-panel">
        <header>
          <UserCircle size={20} strokeWidth={1.8} />
          <h3>Account</h3>
        </header>
        <p>Use the Hub tab for account and license status.</p>
      </section>

      <section className="mobile-panel">
        <header>
          <Shield size={20} strokeWidth={1.8} />
          <h3>Desktop-only settings</h3>
        </header>
        <p>Shortcuts, open-with rules, launch-on-login, advanced diagnostics, and sync policies are edited on desktop.</p>
      </section>

      <section className="mobile-panel">
        <header>
          <Info size={20} strokeWidth={1.8} />
          <h3>About</h3>
        </header>
        <dl className="mobile-detail-list compact">
          <div>
            <dt>App</dt>
            <dd>{app?.appName ?? "Misty"}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>Mobile v1</dd>
          </div>
          <div>
            <dt>Home</dt>
            <dd>{app?.environment.homeDir ?? "Loading"}</dd>
          </div>
        </dl>
        <button type="button" className="mobile-secondary-action" disabled={working} onClick={() => void load()}>
          <RefreshCcw size={17} /> Refresh settings
        </button>
      </section>
    </section>
  );
}

function MobileSwitch(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="mobile-switch-row">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}
