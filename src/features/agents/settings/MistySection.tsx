import { useAuth } from "@/features/account";
import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import { aiSurfaceApi } from "../runs/invocations/api";
import { type AiUserSettings } from "../runs/invocations/aiSettingsTypes";
import { useAiSurfaceStore } from "../runs/invocations/store";
import { confirmAction } from "@/shared/lib/confirmAction";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import { SwitchControl } from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";

export function MistySection(_props: SettingsContentProps) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AiUserSettings | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void aiSurfaceApi
      .settings()
      .then((result) => {
        if (!active) return;
        setSettings(result.settings);
      })
      .catch(() => active && setError("Misty settings could not load."));
    return () => {
      active = false;
    };
  }, []);

  const updateSettings = async (
    enabled: boolean,
    retentionDays = settings?.retention_days ?? 30,
  ) => {
    if (!settings || working) return;
    if (
      !enabled &&
      !(await confirmAction(
        "Turn off Misty everywhere? New AI work will stop immediately. Unaccepted drafts, personal AI preferences, " +
          "private embeddings, and generated metadata will be purged. Accepted work and required audit records remain.",
        "Turn off Misty",
      ))
    ) {
      return;
    }
    setWorking(true);
    setError("");
    try {
      const result = await aiSurfaceApi.updateSettings(enabled, retentionDays);
      setSettings(result.settings);
      if (!enabled && user?.id) useAiSurfaceStore.getState().clearAccount(user.id);
    } catch {
      setError("Misty settings could not be saved. Try again.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <SettingsSectionBlock title="Misty">
        <SettingsRow label="Enable Misty" description="Hosted AI in the panel and across Misty.">
          <SwitchControl
            checked={settings?.enabled ?? false}
            disabled={!settings || working}
            onChange={(value) => void updateSettings(value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
      {error ? (
        <SystemErrorNotice
          error={error}
          scope="settings:misty"
          title="Misty settings need attention"
        />
      ) : null}
    </>
  );
}
