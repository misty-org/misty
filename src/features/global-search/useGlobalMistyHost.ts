import { useEffect, useState } from "react";
import { useLocalExecution } from "@/features/agents/localExecution";
import { installMistyContextBridge } from "@/features/misty/contextBridge";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { isAgentModeActive } from "./searchAvailability";
import { useGlobalSearchStore } from "./useGlobalSearchStore";

/**
 * Host duties of the search launcher: it stays closed while an agent controls
 * the screen, and it installs the context bridge.
 * Returns the bridge's startup error, if any.
 */
export function useGlobalMistyHost() {
  useEffect(() => {
    const enforceAgentMode = () => {
      if (isAgentModeActive() && useGlobalSearchStore.getState().panel !== "closed")
        useGlobalSearchStore.getState().closePanel();
    };
    enforceAgentMode();
    const removeMisty = useMistyStore.subscribe(enforceAgentMode);
    const removeExecution = useLocalExecution.subscribe(enforceAgentMode);
    return () => {
      removeMisty();
      removeExecution();
    };
  }, []);
  const [bridgeError, setBridgeError] = useState("");
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void installMistyContextBridge()
      .then((remove) => {
        if (disposed) remove();
        else cleanup = remove;
      })
      .catch((error) => {
        if (!disposed)
          setBridgeError(error instanceof Error ? error.message : "Misty context could not start.");
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  return bridgeError;
}
