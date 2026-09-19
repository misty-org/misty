import { useEffect, useRef } from "react";
import type { MistyAppSDK, MistyAppCommand } from "@misty/sdk";

/** Host settings resolve bindings; callbacks always read this view's latest state. */
export function useSdkFilesShortcuts(
  misty: MistyAppSDK,
  active: boolean,
  actions: Partial<Record<MistyAppCommand, (() => unknown) | undefined>>,
  report: (error: unknown) => void,
) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    if (!active) return;
    let closed = false;
    const removers: Array<() => void> = [];
    for (const command of Object.keys(latest.current) as MistyAppCommand[]) {
      void misty.shortcuts
        .register(command, () => {
          if (!closed)
            void Promise.resolve()
              .then(() => latest.current[command]?.())
              .catch(report);
        })
        .then((remove) => {
          if (closed) remove();
          else removers.push(remove);
        })
        .catch((error) => {
          if (!closed) report(error);
        });
    }
    return () => {
      closed = true;
      removers.forEach((remove) => remove());
    };
  }, [misty, active, report]);
}
