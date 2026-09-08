import { useEffect, useState } from "react";
import { aiSurfaceApi, type ScreenLocation } from "@/features/ai-surface/api";
import { DesktopSettingsRow, DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { ChoiceControl, SwitchControl } from "../SettingsControls";
import { setKeepAwakeForAgents } from "@/features/agents/keepAwake";

// "window" is a new tab in this window; the stored name predates the label.
const options: { value: ScreenLocation; label: string }[] = [
  { value: "window", label: "New tab" },
  { value: "separate", label: "Separate window" },
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
        setLocation(result.settings.screen_location ?? "window");
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
      setLocation(settings.screen_location ?? value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This setting couldn’t be saved.");
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This setting couldn’t be saved.");
    } finally {
      setWorking(false);
    }
  };
  return (
    <DesktopSettingsSection
      title="Screens"
      description={
        "Agents open a browser only when a task needs one, and look at your screen only " +
        "when you ask about it. Pause or stop them at any time."
      }
    >
      <DesktopSettingsRow
        label="Where Misty opens new screens"
        description={
          "A new tab opens beside your work. A separate window works small in a corner of " +
          "your screen, so you can watch it while this one stays yours. " +
          "Saying where in your request, such as this tab or my whole screen, always wins."
        }
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
        description={
          "While an agent works on one of your computers, it won’t go to sleep. " +
          "The display can still turn off."
        }
      >
        <SwitchControl
          checked={keepAwake ?? true}
          disabled={keepAwake === null || working}
          onChange={(value) => void changeKeepAwake(value)}
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
