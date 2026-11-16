import { useDefaultEngine } from "../../engines/defaultEngine";

/**
 * Whether Tutor is set up: it runs on the default engine, so it's ready once there is one. It
 * hears and speaks through this computer's own speech, with no key.
 */

/** Tutor's engine and whether it's set up; `ready` is undefined until the engines are read. */
export function useTutorSetup(): { engine: string; ready: boolean | undefined } {
  const { engine, ready } = useDefaultEngine();
  return { engine: engine?.name ?? "", ready: ready ? Boolean(engine) : undefined };
}
