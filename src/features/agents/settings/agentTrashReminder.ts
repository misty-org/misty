import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { notify } from "@misty/ui";
import { disk } from "@/features/files";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { hasTauriInternals } from "@/shared/platform/tauri";

const DAY = 24 * 60 * 60 * 1000;
/** Agent trash never empties itself; after this long, a notice suggests looking it over. */
const REMIND_AFTER = 30 * DAY;

/** When the reminder last showed on this device, so it shows at most once a day. */
const lastReminded = createDeviceSetting<number>({
  scope: "files-agent-trash-reminder",
  defaults: 0,
  normalize: (stored) => (typeof stored === "number" ? stored : 0),
});

function whenLoaded(): Promise<void> {
  if (lastReminded.getState().loaded) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = lastReminded.subscribe((state) => {
      if (!state.loaded) return;
      stop();
      resolve();
    });
  });
}

/** Whether the oldest item has waited 30 days and the reminder hasn't shown in the last day. */
export function agentTrashReminderDue(now: number, oldestMs: number | undefined, last: number) {
  return oldestMs !== undefined && now - oldestMs >= REMIND_AFTER && now - last >= DAY;
}

async function remindIfDue(open: () => void, stopped: () => boolean) {
  await whenLoaded();
  const usage = await disk.agentTrashUsage();
  const now = Date.now();
  if (stopped() || !agentTrashReminderDue(now, usage.oldestMs, lastReminded.getState().value)) return;
  lastReminded.getState().set(now);
  notify({
    message: "Some files have waited in Agent trash for 30 days",
    action: { label: "Open agent trash", onSelect: open },
  });
}

/** Once as Misty starts, in the window that runs the device's agent work: the 30-day notice. */
export function useAgentTrashReminder(active: boolean) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!active || !hasTauriInternals()) return;
    let stopped = false;
    void remindIfDue(
      () => void navigate("/agents?view=files"),
      () => stopped,
    ).catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [active, navigate]);
}
