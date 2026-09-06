import {
  DesktopSettingsSection as Section,
  DesktopSettingsRow as Row,
} from "../components/DesktopSettingsUI";
import { SettingsNote } from "../SettingsControls";
import { useSettingsProfiles } from "./store";
import { useSyncController } from "@/features/browser-workspace/useSyncController";
import { SyncStatusView } from "@/features/browser-workspace/SyncStatusView";
export function SettingsSyncSection({ showStatus = true }: { showStatus?: boolean }) {
  const store = useSettingsProfiles();
  const controller = useSyncController(store.accountId, true);
  const pending = store.state?.outbox.length ?? 0;
  return (
    <Section title="Settings sync">
      <SettingsNote>
        Your settings are saved to your account on the server and apply across devices.
      </SettingsNote>
      {showStatus && (
        <div className="pb-3">
          <SyncStatusView
            status={controller.status}
            busy={controller.busy}
            onAction={() => void controller.retry()}
          />
        </div>
      )}
      <Row
        label="Pending settings"
        description={
          pending ? "Waiting to be saved to the server." : "No settings changes waiting to sync."
        }
      >
        <span className="text-sm text-cream-muted">{pending}</span>
      </Row>
    </Section>
  );
}
