import { useDefaultEngine } from "../../engines/default_engine";

export function useTutorSetup(): { engine: string; ready: boolean | undefined } {
  const { engine, ready } = useDefaultEngine();
  return { engine: engine?.name ?? "", ready: ready ? Boolean(engine) : undefined };
}
