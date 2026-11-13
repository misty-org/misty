import { useEffect } from "react";
import { ENGINE_IDS, type EngineId } from "@/features/engine-config/channels";
import { useCliVersionStatus } from "@/features/engine-config/clis";
import { engineSetupState } from "./EngineSetupRow";

/** Whether `engine` is one of the engines Misty knows, so its CLI can be asked how it stands. */
export function isEngineId(engine: string | undefined): engine is EngineId {
  return Boolean(engine) && (ENGINE_IDS as readonly string[]).includes(engine!);
}

/**
 * Says whether an engine is ready the way the setup page decides it (installed and signed in),
 * from the same shared CLI probe, and draws nothing. One per engine, since each reads its own.
 */
export function EngineReadyProbe({
  engine,
  onReady,
}: {
  engine: EngineId;
  onReady(engine: EngineId, ready: boolean): void;
}) {
  const view = useCliVersionStatus(engine);
  const ready = engineSetupState(engine, view) === "ready";
  useEffect(() => onReady(engine, ready), [engine, ready, onReady]);
  return null;
}
