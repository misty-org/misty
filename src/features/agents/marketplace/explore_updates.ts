import { useEffect, useState } from "react";
import { hasCliUpdate, useCliStatuses, type CliVersionStatus } from "@/features/engine-config/clis";
import { skillsHubApi, type SkillRow } from "@/features/engine-config/skills";
import { useSpeechModels, type HearingModelView } from "@/features/voice";
import {
  registryShards,
  useRegistry,
  type ListingEntry,
  type PluginEntry,
} from "@/native/registry";
import { useRegistryEngineIds, useRegistryEngines } from "./engine_catalog";
import { useSpeech } from "./ExploreSpeechParts";
import { exploreApps } from "./explore_apps";
import { failureText } from "./explore_index";
import { useInstallRecords } from "./explore_installs";

export type SpeechEntry = HearingModelView;

export type SkillUpdate = SkillRow & { entry?: ListingEntry };

async function registryUpdates(rows: SkillRow[]): Promise<SkillUpdate[]> {
  const pinned = rows.filter((row) => row.registryId && row.registryCategory && row.bundleSha256);
  const categories = [...new Set(pinned.map((row) => row.registryCategory as string))].filter(
    (category) => useRegistry.getState().listings.skills?.categories[category],
  );
  const shards = await Promise.all(
    categories.map((category) => registryShards.category("skills", category)),
  );
  const listed = new Map(
    shards.flatMap((shard) => shard.items).map((entry) => [entry.id, entry] as const),
  );
  return pinned.flatMap((row) => {
    const entry = listed.get(row.registryId as string);
    return entry?.bundle && entry.bundle.sha256 !== row.bundleSha256 ? [{ ...row, entry }] : [];
  });
}

export function useSkillUpdates() {
  const [rows, setRows] = useState<SkillUpdate[] | null>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    skillsHubApi
      .installed()
      .then(async (installed) => {
        const fromGitHub = installed.skills.filter((row) => !row.registryId);
        const [github, registry] = await Promise.all([
          fromGitHub.length
            ? skillsHubApi.updates()
            : Promise.resolve({ updates: {} as Record<string, unknown> }),
          registryUpdates(installed.skills),
        ]);
        return [...fromGitHub.filter((row) => github.updates[row.id]), ...registry];
      })
      .then(
        (found) => {
          if (!live) return;
          setRows(found);
          setError("");
        },
        (reason: unknown) => live && setError(failureText(reason, "Skill updates couldn't load.")),
      );
    return () => {
      live = false;
    };
  }, [round]);
  return { rows, error, reload: () => setRound((value) => value + 1) };
}

export function useEngineUpdates(options: { probe?: boolean } = {}) {
  const engines = useRegistryEngines();
  const { statuses, settled } = useCliStatuses(useRegistryEngineIds(), options);
  const rows = engines
    .filter((engine) => hasCliUpdate(statuses[engine.id]))
    .map((engine) => ({ engine, status: statuses[engine.id] as CliVersionStatus }));
  return { rows, settled };
}

export function useSpeechUpdates(): SpeechEntry[] | null {
  const catalog = useSpeechModels((state) => state.catalog);
  useEffect(() => {
    if (!useSpeechModels.getState().catalog) void useSpeechModels.getState().load();
  }, []);
  if (!catalog) return null;
  return catalog.hearing.filter((entry) => entry.outdated);
}

export const appProgress = (download: { received: number; total: number } | undefined) =>
  download ? { value: download.total ? download.received / download.total : 0 } : undefined;

export function useDownloads(spaceId: string) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  const { catalog, stateOf } = useSpeech();
  const packages = new Set<string>();
  const speech = (catalog?.hearing ?? []).filter((entry) => {
    if (!stateOf(entry).downloading || packages.has(entry.packageKey)) return false;
    packages.add(entry.packageKey);
    return true;
  });
  return { apps: apps.listed.filter((app) => apps.downloadOf(app.id)), speech, stateOf };
}

export function useAppUpdates(spaceId: string) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  const rows = apps.listed.flatMap((app) => {
    const from = apps.versionOf(app.id);
    return from !== undefined && from !== app.version ? [{ app, from }] : [];
  });
  return { apps, rows };
}

export function usePluginUpdates() {
  const records = useInstallRecords();
  const [rows, setRows] = useState<PluginEntry[]>([]);
  const held = (records.data ?? []).filter((one) => one.kind === "plugins");
  const key = held.map((one) => `${one.id}:${one.digest}`).join(",");
  useEffect(() => {
    if (!key) {
      setRows([]);
      return;
    }
    let live = true;
    const digests = new Map(key.split(",").map((pair) => pair.split(":") as [string, string]));
    registryShards.find("plugins", [...digests.keys()]).then(
      (entries) => {
        if (live)
          setRows(
            entries.filter(
              (entry) => entry.bundle && entry.bundle.sha256 !== digests.get(entry.id),
            ),
          );
      },
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return { rows, reload: () => void records.reload() };
}

export function useMyAppsCount(spaceId: string) {
  const downloads = useDownloads(spaceId);
  const apps = useAppUpdates(spaceId).rows.length;
  const skills = useSkillUpdates().rows?.length ?? 0;
  const engines = useEngineUpdates({ probe: false }).rows.length;
  const speech = useSpeechUpdates()?.length ?? 0;
  const plugins = usePluginUpdates().rows.length;
  return (
    downloads.apps.length + downloads.speech.length + apps + skills + engines + speech + plugins
  );
}
