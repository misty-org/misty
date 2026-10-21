import { useEffect, useState } from "react";
import { devicesApi } from "@/api/devices/api";
import type { AccountDevice } from "@/features/connected-devices/connectedDeviceModel";
import { thisComputerDeviceId } from "./deviceScheduledRuns";

/**
 * The computer a scheduled run works on (roadmap C1): the one the schedule was made on.
 * There is no choice, as with every agent run, which works on the device it was started
 * from. A new schedule takes this computer; an existing one keeps its own.
 */
export function ScheduleComputerField({
  value,
  onChange,
}: {
  value: string;
  onChange(deviceId: string): void;
}) {
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const [here, setHere] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void devicesApi
      .list<{ devices: AccountDevice[] }>()
      .then(({ devices }) => live && setDevices(devices))
      .catch(() => {});
    void thisComputerDeviceId().then((id) => live && setHere(id));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!value && here) onChange(here);
  }, [here, onChange, value]);
  const name =
    value === here ? "this computer" : devices.find((device) => device.id === value)?.name;
  return (
    <p className="agent-method-hint">
      {value
        ? `Runs on ${name ?? "the computer it was made on"} while Misty is open and the computer is awake. ` +
          "If it’s away when a run is due, the run waits for it and says it started late."
        : "Schedules run on the computer they’re made on. Make this one in the Misty app."}
    </p>
  );
}
