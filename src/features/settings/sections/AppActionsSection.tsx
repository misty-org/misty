import { useEffect, useState } from "react";
import { aiSurfaceApi } from "@/features/ai-surface/api";
import { DesktopSettingsRow, DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { SwitchControl } from "../SettingsControls";

/** The account's one autonomy setting for agents acting in connected apps. */
export function AppActionsSection() {
  const [ask, setAsk] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    aiSurfaceApi
      .settings()
      .then((result) => live && setAsk(result.settings.app_actions_ask ?? true))
      .catch(() => live && setError("This setting couldn’t load."));
    return () => {
      live = false;
    };
  }, []);
  const change = async (value: boolean) => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      setAsk((await aiSurfaceApi.updateAppActionsAsk(value)).settings.app_actions_ask);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This setting couldn’t be saved.");
    } finally {
      setWorking(false);
    }
  };
  return (
    <DesktopSettingsSection
      title="Connected apps"
      description={
        "Agents use the apps you connect, such as Gmail, Google Drive and Slack. " +
        "Connect apps from Agents → Integrations or when an agent asks in the chat."
      }
    >
      <DesktopSettingsRow
        label="Ask before acting for you"
        description="Sending, sharing, deleting and paying in connected apps wait for your approval in the chat."
      >
        <SwitchControl
          checked={ask ?? true}
          disabled={ask === null || working}
          onChange={(value) => void change(value)}
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
