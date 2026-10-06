import { SystemErrorNotice } from "@/features/support/systemErrors";
import { useEffect, useState } from "react";
import { installMistyContextBridge } from "./contextBridge";

/** Installs the context bridge agents read the current page and selection through. */
export function MistyContextBridgeHost() {
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void installMistyContextBridge()
      .then((remove) => {
        if (disposed) remove();
        else cleanup = remove;
      })
      .catch((reason) => {
        if (!disposed)
          setError(reason instanceof Error ? reason.message : "Misty context could not start.");
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  return error ? (
    <SystemErrorNotice
      error={error}
      scope="misty:context-bridge"
      title="Misty context could not start"
    />
  ) : null;
}
