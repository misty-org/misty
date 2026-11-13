import { useNotice } from "@/shared/ui";
import { useEffect, useState } from "react";
import { aiSurfaceApi } from "../runs/invocations/api";
import { type ScreenLocation } from "../runs/invocations/aiSettingsTypes";
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
import { ChoiceControl, SwitchControl } from "../../settings/SettingsControls";
import { setKeepAwakeForAgents } from "../runs/jobs/keepAwake";

// "window" is a new tab in this window; the stored name predates the label.
const options: { value: ScreenLocation; label: string }[] = [
  { value: "window", label: "New tab" },
  { value: "ask", label: "Ask each time" },
];

/** Where agents open a screen when a task needs a website or the desktop. */
export function ScreenLocationSection() {
  const [location, setLocation] = useState<ScreenLocation | null>(null);
  const [keepAwake, setKeepAwake] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    aiSurfaceApi
      .settings()
      .then((result) => {
        if (!live) return;
        setLocation(result.settings.screen_location === "ask" ? "ask" : "window");
        setKeepAwake(result.settings.keep_awake_for_agents ?? true);
      })
      .catch(() => live && setError("This setting couldn’t load."));
    return () => {
      live = false;
    };
  }, []);
  const change = async (value: ScreenLocation) => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      const { settings } = await aiSurfaceApi.updateScreenLocation(value);
      setLocation(settings.screen_location === "ask" ? "ask" : "window");
    } catch {
      setError("The screen preference could not be saved. Try again.");
    } finally {
      setWorking(false);
    }
  };
  const changeKeepAwake = async (value: boolean) => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      const { settings } = await aiSurfaceApi.updateKeepAwake(value);
      const next = settings.keep_awake_for_agents ?? value;
      setKeepAwake(next);
      setKeepAwakeForAgents(next);
    } catch {
      setError("The keep-awake preference could not be saved. Try again.");
    } finally {
      setWorking(false);
    }
  };
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  return (
    <DesktopSettingsSection title="Screens">
      <DesktopSettingsRow
        label="Where Misty opens new screens"
        description="Saying where in your request always wins."
      >
        <ChoiceControl
          value={location ?? "window"}
          options={options}
          disabled={location === null || working}
          onValueChange={(value) => void change(value as ScreenLocation)}
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="Keep computers awake"
        description="While an agent works. The display can still turn off."
      >
        <SwitchControl
          checked={keepAwake ?? true}
          disabled={keepAwake === null || working}
          onChange={(value) => void changeKeepAwake(value)}
        />
      </DesktopSettingsRow>
    </DesktopSettingsSection>
  );
}
