import { DesktopSettingsSection } from "../components/DesktopSettingsUI";

/**
 * Connected apps. When agents stop for your OK is no longer an account switch:
 * each chat runs in Ask or Auto, and remembered approvals live under Permissions.
 */
export function AppActionsSection() {
  return (
    <DesktopSettingsSection
      title="Connected apps"
      description={
        "Agents use the apps you connect, such as Gmail, Google Drive and Slack. " +
        "Connect apps from Agents → Integrations or when an agent asks in the chat. " +
        "Each chat’s Ask or Auto decides when agents stop for your OK; approvals you " +
        "remembered are listed under Agents → Permissions."
      }
    >
      {null}
    </DesktopSettingsSection>
  );
}
