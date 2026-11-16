import type { EngineId } from "@/features/engine-config/channels";
import { useCliVersionStatus } from "@/features/engine-config/clis";

/** Where an engine stands for first run: one next step at a time. */
export type EngineSetupState = "checking" | "failed" | "install" | "get" | "sign-in" | "ready";

/**
 * Engines that run with no sign-in of Misty's: OpenCode is free with no account, and DeepSeek
 * Harness keeps its providers in its own web page, so installed is as ready as they get.
 */
const needsNoSignIn = (engine: string) => engine === "opencode" || engine === "dsh";

export function engineSetupState(
  engine: EngineId | string,
  view: Pick<ReturnType<typeof useCliVersionStatus>, "status" | "signIn" | "error">,
): EngineSetupState {
  const { status, signIn, error } = view;
  if (status === null) return error ? "failed" : "checking";
  if (!status.installed) return status.updateKind === null ? "get" : "install";
  // Signed in only when the CLI (or a sign-in Misty watched finish) says so: one that can't say
  // asks for a sign-in rather than failing on the first chat.
  if (signIn?.signedIn !== true && !needsNoSignIn(engine)) return "sign-in";
  return "ready";
}

/**
 * Whether an agent on `engine` can take a message yet: its CLI installed and signed in. Until
 * then the agent stays disabled and shows its engine's next step (`EngineNextStep`). Shares the
 * one cached probe with Settings and setup, so asking here starts no extra `--version`.
 */
export function useEngineReadiness(engine: string) {
  const view = useCliVersionStatus(engine);
  return { view, state: engineSetupState(engine, view) };
}

/** A state that holds an agent back: one that is still being checked, or whose check failed,
 * doesn't, so a slow or broken probe never locks the person out of a working engine. */
export const blocksAgent = (state: EngineSetupState) =>
  state === "install" || state === "get" || state === "sign-in";
