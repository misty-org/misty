import { useState } from "react";
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { activityApi } from "./activityApi";
import { forgetStepPictures } from "./useRunSteps";

/**
 * The steps each run took and the pictures of the pages it worked on, kept on this computer for
 * 90 days for the Activity page. Clearing them leaves the runs themselves and their chats.
 */
export function AgentActivitySettings() {
  const [state, setState] = useState<"" | "clearing" | "cleared" | "failed">("");
  const native = hasTauriInternals();
  const clear = async () => {
    const sure = await confirmAction(
      "Clear every step your agents took and the pictures of the pages they worked on? Their chats stay. This can't be undone.",
      "Clear agent steps",
    );
    if (!sure) return;
    setState("clearing");
    try {
      await activityApi.clear();
      forgetStepPictures();
      setState("cleared");
    } catch {
      setState("failed");
    }
  };
  return (
    <DesktopSettingsSection title="Agent activity">
      <DesktopSettingsRow
        label="Clear agent steps"
        description={
          !native
            ? "Available in the desktop app."
            : state === "cleared"
              ? "Steps and pictures cleared."
              : state === "failed"
                ? "They couldn't be cleared. Try again."
                : "Each run's steps and page pictures, kept on this computer for 90 days."
        }
      >
        <Button disabled={!native || state === "clearing"} onClick={() => void clear()}>
          {state === "clearing" ? "Clearing" : "Clear steps"}
        </Button>
      </DesktopSettingsRow>
    </DesktopSettingsSection>
  );
}
