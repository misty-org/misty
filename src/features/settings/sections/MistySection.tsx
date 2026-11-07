import { useAuth } from "@/features/auth";
import { SystemErrorNotice } from "@/features/support/systemErrors";
import { aiSurfaceApi, type AiMemoryRecord, type AiUserSettings } from "@/features/ai-surface/api";
import { useAiSurfaceStore } from "@/features/ai-surface/store";
import { confirmAction } from "@/shared/lib/confirmAction";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { MistyRememberedSection } from "./MistyRememberedSection";

export function MistySection(_props: SettingsContentProps & { page?: "misty" | "memory" }) {
  const memoryPage = _props.page === "memory";
  const { user } = useAuth();
  const [settings, setSettings] = useState<AiUserSettings | null>(null);
  const [memories, setMemories] = useState<AiMemoryRecord[]>([]);
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
    void aiSurfaceApi
      .memories()
      .then((result) => active && setMemories(result.memories))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const updateSettings = async (
    enabled: boolean,
    retentionDays = settings?.retention_days ?? 30,
    memoryEnabled = settings?.memory_enabled ?? true,
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
      const result = await aiSurfaceApi.updateSettings(enabled, retentionDays, memoryEnabled);
      setSettings(result.settings);
      if (!enabled && user?.id) useAiSurfaceStore.getState().clearAccount(user.id);
    } catch {
      setError("Misty settings could not be saved. Try again.");
    } finally {
      setWorking(false);
    }
  };

  const forgetMemory = async (memoryId: string) => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await aiSurfaceApi.forgetMemory(memoryId);
      setMemories((items) => items.filter((item) => item.id !== memoryId));
    } catch {
      setError("That memory could not be forgotten. Try again.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      {!memoryPage && (
        <SettingsSectionBlock title="Misty">
          <SettingsRow label="Enable Misty" description="Hosted AI in the panel and across Misty.">
            <SwitchControl
              checked={settings?.enabled ?? false}
              disabled={!settings || working}
              onChange={(value) => void updateSettings(value)}
            />
          </SettingsRow>
        </SettingsSectionBlock>
      )}

      {memoryPage && (
        <>
          <MistyRememberedSection
            settings={settings}
            working={working}
            memories={memories}
            onMemoryEnabledChange={(value) =>
              void updateSettings(true, settings?.retention_days ?? 30, value)
            }
            onForget={(memoryId) => void forgetMemory(memoryId)}
          />
        </>
      )}
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
