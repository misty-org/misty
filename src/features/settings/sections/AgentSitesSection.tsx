import { ErrorNotification } from "@/shared/ui";
import { useEffect, useState, type ReactNode } from "react";
import { aiSurfaceApi, type AiUserSettings } from "@/features/ai-surface/api";
import { DesktopSettingsRow, DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { SwitchControl, TextAreaControl } from "../SettingsControls";

/** Access › Limits: what agents stop and ask about, including sites they may read but never
 * click, type or submit on. Rows passed as children come first. */
export function AgentSitesSection(props: { children?: ReactNode }) {
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
    <DesktopSettingsSection title="Limits">
      {props.children}
      <DesktopSettingsRow
        label="Banking, crypto and adult sites"
        description="Agents read these sites but never act on them."
      >
        <SwitchControl
          checked={settings?.agent_block_sensitive ?? true}
          disabled={!settings || working}
          onChange={(value) => void save({ block_sensitive: value })}
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow label="Other sites" description="One per line. Covers subdomains.">
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
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </DesktopSettingsSection>
  );
}
