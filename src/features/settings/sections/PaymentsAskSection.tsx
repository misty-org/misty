import { useEffect, useState } from "react";
import { aiSurfaceApi } from "@/features/ai-surface/api";
import { DesktopSettingsRow, DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { SwitchControl } from "../SettingsControls";

/** Whether agents stop for your OK before they pay, even while a chat is in Auto. */
export function PaymentsAskSection() {
  const [paymentsAsk, setPaymentsAsk] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    aiSurfaceApi
      .settings()
      .then((result) => live && setPaymentsAsk(result.settings.payments_ask ?? true))
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
      const { settings } = await aiSurfaceApi.updatePaymentsAsk(value);
      setPaymentsAsk(settings.payments_ask ?? value);
    } catch {
      setError("This setting couldn’t be saved. Try again.");
    } finally {
      setWorking(false);
    }
  };
  return (
    <DesktopSettingsSection title="Payments">
      <DesktopSettingsRow
        label="Ask before paying"
        description={
          "Agents stop and ask you before they pay or buy anything, even while a chat is in " +
          "Auto. Turned off, they pay on their own."
        }
      >
        <SwitchControl
          checked={paymentsAsk ?? true}
          disabled={paymentsAsk === null || working}
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
