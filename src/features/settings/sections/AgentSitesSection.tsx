import { useEffect, useState } from "react";
import { aiSurfaceApi, type AiUserSettings } from "@/features/ai-surface/api";
import { DesktopSettingsRow, DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { SwitchControl, TextAreaControl } from "../SettingsControls";

/** Sites agents may read but never click, type or submit on. */
export function AgentSitesSection() {
  const [settings, setSettings] = useState<AiUserSettings | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    aiSurfaceApi
      .settings()
      .then((result) => live && setSettings(result.settings))
      .catch(() => live && setError("These settings couldn’t load."));
    return () => {
      live = false;
    };
  }, []);
  const save = async (change: { block_sensitive?: boolean; blocked_sites?: string[] }) => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      setSettings((await aiSurfaceApi.updateAgentSites(change)).settings);
    } catch {
      setError("Site access could not be saved. Try again.");
    } finally {
      setWorking(false);
    }
  };
  const sites = settings?.agent_blocked_sites ?? [];
  return (
    <DesktopSettingsSection
      title="Sites agents don’t act on"
      description={
        "Agents can still read these sites to answer you, but never click, type or submit " +
        "on them. The task stops there and asks you to take that step."
      }
    >
      <DesktopSettingsRow
        label="Banking, crypto and adult sites"
        description="Covers banks, brokerages, payment apps, crypto exchanges and wallets, and adult sites."
      >
        <SwitchControl
          checked={settings?.agent_block_sensitive ?? true}
          disabled={!settings || working}
          onChange={(value) => void save({ block_sensitive: value })}
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="Other sites"
        description="One address per line, such as example.com. Each covers its subdomains."
      >
        <TextAreaControl
          value={sites.join("\n")}
          placeholder="example.com"
          rows={3}
          disabled={!settings || working}
          onCommit={(value) =>
            void save({
              blocked_sites: value
                .split(/[\n,]/)
                .map((site) => site.trim())
                .filter(Boolean),
            })
          }
        />
      </DesktopSettingsRow>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-cream-muted">
          {error}
        </p>
      ) : null}
    </DesktopSettingsSection>
  );
}
