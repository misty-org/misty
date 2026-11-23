import type { EngineId } from "@/features/engine-config/channels";
import { useCliVersionStatus } from "@/features/engine-config/clis";

export type EngineSetupState = "checking" | "failed" | "install" | "get" | "sign-in" | "ready";

const needsNoSignIn = (engine: string) => engine === "opencode" || engine === "dsh";

export function engineSetupState(
  engine: EngineId | string,
  view: Pick<ReturnType<typeof useCliVersionStatus>, "status" | "signIn" | "error">,
): EngineSetupState {
  const { status, signIn, error } = view;
  if (status === null) return error ? "failed" : "checking";
  if (!status.installed) return status.updateKind === null ? "get" : "install";
  if (signIn?.signedIn !== true && !needsNoSignIn(engine)) return "sign-in";
  return "ready";
}

export function useEngineReadiness(engine: string) {
  const view = useCliVersionStatus(engine);
  return { view, state: engineSetupState(engine, view) };
}

export const blocksAgent = (state: EngineSetupState) =>
  state === "install" || state === "get" || state === "sign-in";
