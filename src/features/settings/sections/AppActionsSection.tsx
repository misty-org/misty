import { useEffect, useState } from "react";
import { aiSurfaceApi, type AiUserSettings } from "@/features/ai-surface/api";
import { DesktopSettingsRow, DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { SwitchControl } from "../SettingsControls";

type Approvals = Pick<AiUserSettings, "app_actions_ask" | "payments_ask">;

/** How much agents may do on their own: everything, everything but paying, or nothing unasked. */
export function AppActionsSection() {
  const [approvals, setApprovals] = useState<Approvals | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    aiSurfaceApi
      .settings()
      .then((result) => live && setApprovals(result.settings))
      .catch(() => live && setError("This setting couldn’t load."));
    return () => {
      live = false;
    };
  }, []);
  const change = async (next: { ask?: boolean; payments?: boolean }) => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      setApprovals((await aiSurfaceApi.updateAppActionsAsk(next)).settings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This setting couldn’t be saved.");
    } finally {
      setWorking(false);
    }
  };
  const ask = approvals?.app_actions_ask ?? false;
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
        description="Agents send, share, delete and post on their own while you watch. Turn this on to approve each one first."
      >
        <SwitchControl
          checked={ask}
          disabled={approvals === null || working}
          onChange={(value) => void change({ ask: value })}
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="Ask before paying"
        description="Buying, paying and transfers wait for your approval even when agents act on their own."
      >
        <SwitchControl
          checked={ask || (approvals?.payments_ask ?? true)}
          disabled={approvals === null || working || ask}
          onChange={(value) => void change({ payments: value })}
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
