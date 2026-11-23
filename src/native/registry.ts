import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { invoke } from "@/shared/platform/native_invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import bundled from "@/shared/registry/registry.json";

interface RegistryDocument {
  apps: { apps: unknown[] };
  engines: { engines: unknown[] };
  published_at: string;
}

const first: RegistryDocument = {
  apps: bundled.apps as RegistryDocument["apps"],
  engines: bundled.engines as RegistryDocument["engines"],
  published_at: "",
};

export const useRegistry = create<RegistryDocument>(() => first);

async function load() {
  try {
    useRegistry.setState(await invoke<RegistryDocument>("registry_get"));
  } catch {}
}

let followed = false;

export function followRegistry() {
  if (followed || !hasTauriInternals()) return;
  followed = true;
  void load();
  void listen("misty://registry-changed", () => void load());
}
