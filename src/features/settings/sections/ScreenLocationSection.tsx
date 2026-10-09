import { useEffect, useState } from "react";
import { aiSurfaceApi, type ScreenLocation } from "@/features/ai-surface/api";
import { DesktopSettingsRow, DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { ChoiceControl } from "../SettingsControls";

// "window" is a new tab in this window; the stored name predates the label.
const options: { value: ScreenLocation; label: string }[] = [
  { value: "window", label: "New tab" },
  { value: "separate", label: "Separate window" },
  { value: "ask", label: "Ask each time" },
];

/** Where agents open a screen when a task needs a website or the desktop. */
export function ScreenLocationSection() {
  const [location, setLocation] = useState<ScreenLocation | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    aiSurfaceApi
      .settings()
      .then((result) => live && setLocation(result.settings.screen_location ?? "window"))
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
          "A new tab opens beside your work. A separate window leaves this one to you. " +
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
      {error ? (
        <p role="alert" className="mt-2 text-xs text-cream-muted">
          {error}
        </p>
      ) : null}
    </DesktopSettingsSection>
  );
}
