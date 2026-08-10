import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useUserStore } from "@/store/userStore";
import { updateDevice, type MeResponse } from "../../api";
import { SaveFeedback } from "../../components/SaveFeedback";
import { customRowClass } from "../../components/SettingsRows";
import { useSave } from "../../useSave";

/**
 * Rebinding the licensed device from the web is the recovery path for someone
 * whose machine is gone — which is exactly the case where the desktop app
 * cannot help.
 */
export function LicenseDevice({ me }: { me: MeResponse }) {
  const patchMe = useUserStore((state) => state.patchMe);
  const [device, setDevice] = useState(me.license_device);
  const { saving, error, ok, save } = useSave(async () => {
    const next = device.trim();
    await updateDevice(next);
    patchMe({ license_device: next });
  });

  return (
    <div className={`${customRowClass} flex flex-col gap-3`}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <label
            htmlFor="account-license-device"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Licensed device
          </label>
          <Input
            id="account-license-device"
            type="text"
            value={device}
            onChange={(event) => setDevice(event.target.value)}
            aria-describedby="account-license-device-description"
          />
          <p
            id="account-license-device-description"
            className="mt-1 text-xs text-muted-foreground"
          >
            The machine your license is bound to. Change this if you moved to a
            new computer.
          </p>
        </div>
        <div className="flex items-center gap-3 max-[520px]:flex-col max-[520px]:items-stretch">
          <Button
            type="button"
            variant="outline"
            onClick={save}
            disabled={
              saving ||
              device.trim() === "" ||
              device.trim() === me.license_device
            }
            aria-busy={saving}
          >
            {saving ? <Spinner aria-hidden="true" /> : null}
            {saving ? "Saving…" : "Update device"}
          </Button>
          <SaveFeedback ok={ok} error={error} />
        </div>
      </div>
    </div>
  );
}
