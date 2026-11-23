import { invoke } from "@/native/invoke";
import type { EngineId } from "../channels/engines";

export interface EngineEnvVar {
  name: string;
  secret: boolean;
  value: string | null;
}

export const engineEnvApi = {
  list: (engine: EngineId) => invoke<EngineEnvVar[]>("engine_env_list", { engine }),
  set: (engine: EngineId, name: string, value: string, previous?: string) =>
    invoke<EngineEnvVar[]>("engine_env_set", { engine, name, value, previous: previous ?? null }),
  remove: (engine: EngineId, name: string) =>
    invoke<EngineEnvVar[]>("engine_env_remove", { engine, name }),
};
