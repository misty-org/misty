import { useNotice } from "@/shared/ui";
import { useEffect, useState } from "react";
import { aiSurfaceApi } from "../runs/invocations/api";
import { DesktopSettingsRow } from "@/features/settings";
import { SwitchControl } from "../../settings/SettingsControls";

/** Whether agents stop for your OK before they pay, even while a chat is in Auto. A row in
 * Access › Limits. */
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
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  return (
    <>
      <DesktopSettingsRow label="Ask before paying" description="Even while a chat is in Auto.">
        <SwitchControl
          checked={paymentsAsk ?? true}
          disabled={paymentsAsk === null || working}
          onChange={(value) => void change(value)}
        />
      </DesktopSettingsRow>
    </>
  );
}
