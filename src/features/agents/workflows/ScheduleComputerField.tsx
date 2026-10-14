import { useEffect, useState } from "react";
import { devicesApi } from "@/api/devices/api";
import type { AccountDevice } from "@/features/connected-devices/connectedDeviceModel";
import { OptionSelect } from "@/shared/ui";
import { thisComputerDeviceId } from "./deviceScheduledRuns";

/**
 * Which computer's Misty browser a scheduled run uses (roadmap C1). The run
 * happens there while Misty is open and the computer is awake; one that comes
 * due while it's away waits for it. None runs without a browser.
 */
export function ScheduleComputerField({
  value,
  onChange,
  needsBrowser,
}: {
  value: string;
  onChange(deviceId: string): void;
  needsBrowser: boolean;
}) {
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const [here, setHere] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void devicesApi
      .list<{ devices: AccountDevice[] }>()
      .then(
        ({ devices }) => live && setDevices(devices.filter((d) => d.admissionState !== "revoked")),
      )
      .catch(() => {});
    void thisComputerDeviceId().then((id) => live && setHere(id));
    return () => {
      live = false;
    };
  }, []);
  // A browser workflow defaults to the computer the person is scheduling it on.
  useEffect(() => {
    if (needsBrowser && !value && here) onChange(here);
  }, [here, needsBrowser, onChange, value]);
  const options = [
    ...(needsBrowser ? [] : [{ value: "", label: "None: runs on Misty’s servers, no browser" }]),
    ...devices.map((device) => ({
      value: device.id,
      label: device.id === here ? `${device.name} (this computer)` : device.name,
    })),
  ];
  return (
    <label>
      Computer
      <OptionSelect
        aria-label="Computer"
        value={value}
        placeholder="Choose a computer"
        options={options}
        onValueChange={onChange}
      />
      <span className="agent-method-hint">
        {value
          ? "Runs in Misty’s browser on that computer while Misty is open and the computer is awake. " +
            "If it’s away when a run is due, the run waits for it and says it started late. It never runs in the cloud instead."
          : "Without a computer, the agent can’t use a browser for this workflow."}
      </span>
    </label>
  );
}
