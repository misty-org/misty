import { invoke } from "@/native/invoke";
import type { EngineId } from "../channels/engines";

/** One of an engine's environment variables. A secret's value never comes back from native code. */
export interface EngineEnvVar {
  name: string;
  secret: boolean;
  value: string | null;
}

/**
 * The variables the person sets for an engine's CLI (`engine_env.rs`). Every value is kept in the
 * keychain on this computer, never synced, and goes only into that CLI's environment when Misty
 * starts it. A channel chosen for a chat wins over these.
 */
export const engineEnvApi = {
  list: (engine: EngineId) => invoke<EngineEnvVar[]>("engine_env_list", { engine }),
  set: (engine: EngineId, name: string, value: string, previous?: string) =>
    invoke<EngineEnvVar[]>("engine_env_set", { engine, name, value, previous: previous ?? null }),
  remove: (engine: EngineId, name: string) =>
    invoke<EngineEnvVar[]>("engine_env_remove", { engine, name }),
};
