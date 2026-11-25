import { useCallback, useEffect, useMemo } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { skillsHubApi, type SkillRow, type SkillTargetId } from "@/features/engine-config/skills";
import { mcpApi, useMcpInventory } from "@/features/engine-config/mcp";
import { openExternalLink } from "@/shared/platform/open_external_link";
import {
  registryInstalls,
  registryShards,
  type ListingEntry,
  type McpEntry,
  type PluginEntry,
  type PluginOutcome,
} from "@/native/registry";
import { useEnginesList } from "../engines/engines_api";
import { directAppsApi, listenDirectApps } from "../connected-apps/direct_api";
import { agentAccountId } from "../personal/agent_account";
import { personalAgentsApi } from "../personal/personal_agents_api";
import { usePersonalAgentsStore } from "../personal/personal_agents_store";
import { frontMatter } from "./explore_index";

const skillTargets: Partial<Record<string, SkillTargetId>> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  kimi: "kimi",
  grok: "grok",
  qoder: "qoder",
  "qoder-cn": "qoder-cn",
  agy: "agy",
  qwen: "qwen",
};

const mcpEngines = new Set(["claude", "codex"]);
const pluginEngines = new Set(["claude", "codex"]);

export function useReadyEngines() {
  const list = useEnginesList();
  return useMemo(
    () =>
      (list.data ?? [])
        .filter((engine) => engine.installed)
        .map((engine) => ({
          id: engine.id,
          name: engine.name,
          skills: skillTargets[engine.id],
          mcp: mcpEngines.has(engine.id) && engine.supportsMcp !== false,
          plugins: pluginEngines.has(engine.id),
        })),
    [list.data],
  );
}

const skillDirectory = (repo: string, path: string) =>
  path === "." || path === "" ? (repo.split("/")[1] ?? repo) : path;

export const skillKey = (repo: string, path: string) =>
  `${repo}:${skillDirectory(repo, path)}`.toLowerCase();

export function useSkillsHere() {
  const resource = useCachedResource("explore/skills-installed", () => skillsHubApi.installed(), {
    persist: "device",
  });
  const byKey = useMemo(
    () => new Map((resource.data?.skills ?? []).map((row) => [row.id.toLowerCase(), row] as const)),
    [resource.data],
  );
  return {
    loaded: Boolean(resource.data),
    rows: resource.data?.skills ?? null,
    of: (entry: ListingEntry): SkillRow | undefined =>
      entry.source ? byKey.get(skillKey(entry.source.repo, entry.source.path)) : undefined,
    reload: resource.reload,
  };
}

export function installSkill(entry: ListingEntry, targets: SkillTargetId[]) {
  if (!entry.source) return Promise.reject(new Error("This skill names no repository."));
  const [repoOwner, repoName] = entry.source.repo.split("/");
  return skillsHubApi.installFromRegistry(
    {
      name: entry.name,
      description: entry.description,
      directory: skillDirectory(entry.source.repo, entry.source.path),
      repoOwner,
      repoName,
      repoBranch: entry.source.commit,
      ...(entry.bundle
        ? {
            bundle: { url: entry.bundle.url, sha256: entry.bundle.sha256, size: entry.bundle.size },
          }
        : {}),
      registry: { id: entry.id, category: entry.category },
    },
    targets,
  );
}

export const templateOrigin = (entry: ListingEntry) => `template:${entry.id}`;

export function useTemplateAgents() {
  const agents = usePersonalAgentsStore((state) => state.agents);
  return (entry: ListingEntry) => agents.filter((agent) => agent.origin === templateOrigin(entry));
}

export async function makeAgentFromTemplate(entry: ListingEntry) {
  if (!entry.source) throw new Error("This template names no repository.");
  const markdown = entry.bundle
    ? await registryInstalls.bundleText(entry.bundle)
    : await registryShards.source(entry.source.repo, entry.source.commit, entry.source.path);
  const { fields, body } = frontMatter(markdown);
  const description = (fields.description || entry.description).slice(0, 2000);
  const agent = await personalAgentsApi.save({
    name: (fields.name && !/[-_]/.test(fields.name) ? fields.name : entry.name).slice(0, 80),
    role: description.slice(0, 160),
    description,
    instructions: "",
    soul: body.trim().slice(0, 100000),
    icon: "",
    avatar: {},
    model_mode: "automatic",
    model_id: "",
    reasoning_effort: "",
    enabled: true,
    default_run_mode: "ask",
    origin: templateOrigin(entry),
  });
  void usePersonalAgentsStore.getState().load(agentAccountId());
  return agent;
}

const packageCommand = (entry: McpEntry): { command: string; args: string[] } | null => {
  const pkg = entry.package;
  if (!pkg) return null;
  const own = pkg.args ?? [];
  if (pkg.type === "npm")
    return { command: "npx", args: ["-y", `${pkg.identifier}@${pkg.version}`, ...own] };
  if (pkg.type === "pypi")
    return { command: "uvx", args: [`${pkg.identifier}==${pkg.version}`, ...own] };
  if (pkg.type === "oci")
    return {
      command: "docker",
      args: ["run", "-i", "--rm", `${pkg.identifier}:${pkg.version}`, ...own],
    };
  return null;
};

export const runsHere = (entry: McpEntry) => packageCommand(entry) !== null;

export function useMcpHere() {
  const inventory = useMcpInventory(null);
  const connections = useCachedResource("direct-apps/connections", () => directAppsApi.list(), {
    persist: "device",
  });
  const { reload: reloadConnections } = connections;
  useEffect(() => {
    const stop = listenDirectApps(() => void reloadConnections());
    return () => {
      void stop.then((unlisten) => unlisten());
    };
  }, [reloadConnections]);
  const of = useCallback(
    (entry: McpEntry) => {
      const connection = entry.remote
        ? (connections.data ?? []).find((one) => one.url === entry.remote?.url)
        : undefined;
      const configured = (inventory.inventory?.engines ?? []).flatMap((engine) =>
        engine.config.entries.filter((one) => one.name === entry.id),
      );
      return { connection, configured };
    },
    [connections.data, inventory.inventory],
  );
  return {
    loaded: Boolean(inventory.inventory) && Boolean(connections.data),
    of,
    reload: () => {
      void inventory.reload();
      void connections.reload();
    },
    setEnabled: inventory.setEnabled,
  };
}

export async function connectRemote(entry: McpEntry) {
  if (!entry.remote) return;
  const { url } = await directAppsApi.connect(entry.remote.url, entry.name);
  await openExternalLink(url);
}

export const disconnectRemote = (id: string) => directAppsApi.disconnect(id);

export async function removePackage(entry: McpEntry, engines: string[]) {
  for (const engine of engines) await mcpApi.remove(engine, entry.id);
  if (entry.env?.length) await registryInstalls.mcpKeys(entry.id, []);
}

export async function addPackage(entry: McpEntry, engines: string[], keys: [string, string][]) {
  const run = packageCommand(entry);
  if (!run) throw new Error(`${entry.name} doesn't run on this computer through Misty.`);
  const target = keys.length
    ? {
        transport: "stdio" as const,
        command: "/bin/sh",
        args: [
          "-c",
          'set -a; . "$0"; set +a; exec "$@"',
          await registryInstalls.mcpKeys(entry.id, keys),
          run.command,
          ...run.args,
        ],
      }
    : { transport: "stdio" as const, command: run.command, args: run.args };
  for (const engine of engines) {
    await mcpApi.add({ engine, name: entry.id, target, env: [], headers: [] });
  }
}

export function useInstallRecords() {
  return useCachedResource("explore/registry-installs", () => registryInstalls.list());
}

export async function installPlugin(
  entry: PluginEntry,
  engines: ReturnType<typeof useReadyEngines>,
  ask: (engine: string, command: string) => Promise<boolean>,
) {
  if (!entry.bundle || !entry.source)
    throw new Error(`${entry.name} has no bundle in the registry yet.`);
  const native = engines.filter((engine) => engine.plugins).map((engine) => engine.id);
  const skillTargets = engines.flatMap((engine) =>
    !engine.plugins && engine.skills ? [engine.skills] : [],
  );
  if (!native.length && !skillTargets.length)
    throw new Error("Install an engine first: plugins go into each engine.");
  const request = {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    repo: entry.source.repo,
    commit: entry.source.commit,
    path: entry.source.path,
    bundle: entry.bundle,
    native,
    skillTargets,
  };
  let outcome: PluginOutcome = await registryInstalls.installPlugin(request);
  while (outcome.result === "confirmCommand") {
    const asked = outcome;
    const engine = engines.find((one) => one.id === asked.engine)?.name ?? asked.engine;
    const command = asked.command;
    if (!(await ask(engine, command.command))) return null;
    outcome = await registryInstalls.installPlugin({ ...request, accept: command.sha256 });
  }
  return outcome.placed;
}
