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

export const listingKinds = ["templates", "skills", "plugins", "mcps"] as const;
export type ListingKind = (typeof listingKinds)[number];

export interface RegistryCategory {
  id: string;
  name: string;
}

export interface ShardRef {
  path: string;
  sha256: string;
  size: number;
}

export interface Listing {
  count: number;
  top: ShardRef;
  categories: Record<string, ShardRef & { count: number }>;
}

export interface RegistryFile {
  url: string;
  sha256: string;
  size: number;
  type?: string;
}

export interface PinnedSource {
  repo: string;
  commit: string;
  path: string;
}

export interface ListingEntry {
  id: string;
  name: string;
  description: string;
  maker: string;
  license?: string;
  category: string;
  rank?: number;
  digest?: string;
  also?: ({ repo: string; path: string } | { registry: string })[];
  source?: PinnedSource;
  bundle?: RegistryFile;
  avatar?: string;
}

export interface PluginEntry extends ListingEntry {
  includes?: {
    skills: number;
    agents: number;
    commands: number;
    hooks: boolean;
    mcp: boolean;
  };
}

export interface McpEnv {
  name: string;
  secret: boolean;
  required: boolean;
}

export interface McpEntry extends ListingEntry {
  homepage?: string;
  remote?: { url: string };
  package?: { type: string; identifier: string; version: string; args?: string[] };
  env?: McpEnv[];
  registry?: { name: string };
}

export type EntryOf<K extends ListingKind> = K extends "plugins"
  ? PluginEntry
  : K extends "mcps"
    ? McpEntry
    : ListingEntry;

export interface Shard<K extends ListingKind = ListingKind> {
  kind: K;
  category?: string;
  items: EntryOf<K>[];
}

interface RegistryDocument {
  categories: RegistryCategory[];
  apps: unknown[];
  engines: unknown[];
  speech: unknown;
  ignore: IgnoreTemplate[];
  listings: Partial<Record<ListingKind, Listing>>;
  published_at: string;
}

const first: RegistryDocument = {
  categories: [],
  apps: [],
  engines: [],
  speech: null,
  ignore: [],
  listings: {},
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

export interface InstallPlaced {
  engine: string;
  how: "plugin" | "skills";
  skills: string[];
}

export interface InstallRecord {
  kind: string;
  id: string;
  digest: string;
  name: string;
  placed: InstallPlaced[];
  installedAt: number;
}

export interface ShownCommand {
  command: string;
  sha256: string;
}

export type PluginOutcome =
  | { result: "installed"; placed: InstallPlaced[] }
  | { result: "confirmCommand"; engine: string; command: ShownCommand };

export interface PluginRequest {
  id: string;
  name: string;
  description: string;
  repo: string;
  commit: string;
  path: string;
  bundle: RegistryFile;
  native: string[];
  skillTargets: string[];
  accept?: string;
}

export const registryInstalls = {
  list: () => invoke<InstallRecord[]>("registry_installs"),
  installPlugin: (request: PluginRequest) =>
    invoke<PluginOutcome>("registry_plugin_install", { request }),
  removePlugin: (id: string) => invoke<void>("registry_plugin_remove", { id }),
  bundleText: (bundle: RegistryFile, path?: string) =>
    invoke<string>("registry_bundle_text", { bundle, path: path ?? null }),
  sample: (file: RegistryFile) => invoke<ArrayBuffer>("registry_sample", { file }),
  mcpKeys: (server: string, values: [string, string][]) =>
    invoke<string>("registry_mcp_keys", { server, values }),
};

export const registryShards = {
  source: (repo: string, commit: string, path: string) =>
    invoke<string>("registry_source_file", { repo, commit, path }),
  find: <K extends ListingKind>(kind: K, ids: string[]) =>
    invoke<EntryOf<K>[]>("registry_find", { kind, ids }),
  search: (query: string, kind: ListingKind | undefined, limit: number) =>
    invoke<Partial<Record<ListingKind, { count: number; items: ListingEntry[] }>>>(
      "registry_search",
      {
        query,
        kind: kind ?? null,
        limit,
      },
    ),
  top: <K extends ListingKind>(kind: K) => invoke<Shard<K>>("registry_top", { kind }),
  category: <K extends ListingKind>(kind: K, category: string) =>
    invoke<Shard<K>>("registry_category", { kind, category }),
};
