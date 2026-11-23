import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { invoke } from "@/shared/platform/native_invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface IgnoreTemplate {
  id: string;
  name: string;
  markers: string[];
  rules: string[];
}

interface RegistryDocument {
  apps: { apps: unknown[] };
  engines: { engines: unknown[] };
  ignore?: { templates?: IgnoreTemplate[] } | null;
  published_at: string;
}

const first: RegistryDocument = {
  apps: { apps: [] },
  engines: { engines: [] },
  ignore: null,
  published_at: "",
};

export const useRegistry = create<RegistryDocument>(() => first);

async function load() {
  try {
    useRegistry.setState(await invoke<RegistryDocument>("registry_get"));
  } catch {}
}

let followed: Promise<void> | undefined;

export function followRegistry(): Promise<void> {
  if (followed) return followed;
  if (!hasTauriInternals()) return Promise.resolve();
  followed = load();
  void listen("misty://registry-changed", () => void load());
  return followed;
}
