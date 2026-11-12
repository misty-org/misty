// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * A bot bundle (a folder of bot.json, SOUL.md and AGENTS.md) as one of the person's Misty agents.
 * Native code reads and writes the folder the person picks (`src-tauri/features/bots`); here the
 * bundle maps onto the agent's fields. A bundle's memory settings are kept so an export carries
 * them back out; Misty itself remembers nothing.
 */
import { invoke } from "@/native/invoke";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { personalAgentsApi } from "../personal/personalAgentsApi";

export interface BotAvatar {
  type: "generated" | "emoji" | "image";
  value?: string;
  foldShape?: string;
  eyes?: string;
  hue?: number;
  saturation?: number;
  lightness?: number;
}

export interface BotBundle {
  id: string;
  slug: string;
  name: string;
  title?: string | null;
  description?: string | null;
  avatar: BotAvatar;
  soul: string;
  instructions: string;
  capabilities: { skills: string[]; tools: string[]; mcpServers: string[] };
  runtime: {
    kind: string;
    model?: string | null;
    cwd?: string | null;
    extraArgs: string[];
    permissionMode: "ask" | "auto-safe" | "full";
  };
  memory: {
    enabled: boolean;
    writeApproval: boolean;
    memoryCharLimit: number;
    reviewEnabled: boolean;
    reviewEveryNTurns: number;
  };
  builtinId?: string | null;
}

const defaultMemory: BotBundle["memory"] = {
  enabled: true,
  writeApproval: false,
  memoryCharLimit: 2200,
  reviewEnabled: true,
  reviewEveryNTurns: 5,
};

/** ccgui's runtime names and Misty's engine ids. Anything else is taken as an engine id. */
const runtimeToEngine: Record<string, string | undefined> = {
  direct: undefined,
  "claude-code": "claude",
  codex: "codex",
};

const engineToRuntime = (engine?: string) =>
  !engine || engine === "misty" ? "direct" : engine === "claude" ? "claude-code" : engine;

/** The agent a bundle makes. */
export function agentFromBundle(bundle: BotBundle): AgentProfileInput {
  const engine =
    bundle.runtime.kind in runtimeToEngine
      ? runtimeToEngine[bundle.runtime.kind]
      : bundle.runtime.kind;
  return {
    name: bundle.name.slice(0, 80),
    role: (bundle.title ?? "").slice(0, 160),
    description: (bundle.description ?? "").slice(0, 2000),
    instructions: bundle.instructions.slice(0, 16000),
    soul: bundle.soul,
    icon: "sparkles",
    avatar:
      bundle.avatar.type === "emoji" && bundle.avatar.value
        ? { kind: "emoji", value: bundle.avatar.value }
        : { bot: { ...bundle.avatar } },
    model_mode: "automatic",
    model_id: "",
    reasoning_effort: "",
    enabled: true,
    default_run_mode: bundle.runtime.permissionMode === "ask" ? "ask" : "auto",
    engine,
    engine_model: engine ? (bundle.runtime.model ?? undefined) : undefined,
    tools: bundle.capabilities.tools,
    mcp_servers: bundle.capabilities.mcpServers,
    skills: bundle.capabilities.skills,
    runtime_cwd: bundle.runtime.cwd ?? undefined,
    runtime_args: bundle.runtime.extraArgs,
    origin: bundle.builtinId
      ? `bot:${bundle.builtinId}`
      : bundle.slug
        ? `bot:${bundle.slug}`
        : "bot",
  };
}

/** The bundle an agent writes out as. */
export function bundleFromAgent(agent: AgentProfile): BotBundle {
  const saved = (agent.avatar as { bot?: BotAvatar; kind?: string; value?: string }) ?? {};
  const avatar: BotAvatar = saved.bot
    ? saved.bot
    : saved.kind === "emoji" && saved.value
      ? { type: "emoji", value: saved.value }
      : { type: "generated" };
  return {
    id: agent.id,
    slug: "",
    name: agent.name,
    title: agent.role || null,
    description: agent.description || null,
    avatar,
    soul: agent.soul ?? "",
    instructions: agent.instructions,
    capabilities: {
      skills: agent.skills ?? [],
      tools: agent.tools ?? [],
      mcpServers: agent.mcp_servers ?? [],
    },
    runtime: {
      kind: engineToRuntime(agent.engine),
      model: agent.engine_model || null,
      cwd: agent.runtime_cwd || null,
      extraArgs: agent.runtime_args ?? [],
      permissionMode: agent.default_run_mode === "auto" ? "auto-safe" : "ask",
    },
    memory: defaultMemory,
  };
}

/** Imports the bot folder the person picks as a new agent. `undefined` when they cancel. */
export async function importBotBundle(): Promise<AgentProfile | undefined> {
  const bundle = await invoke<BotBundle | null>("bot_bundle_import");
  if (!bundle) return undefined;
  return personalAgentsApi.save(agentFromBundle(bundle));
}

/** Writes an agent out as a bot folder where the person picks. The folder's name, or undefined. */
export async function exportBotBundle(agent: AgentProfile): Promise<string | undefined> {
  const folder = await invoke<string | null>("bot_bundle_export", {
    bundle: bundleFromAgent(agent),
  });
  return folder ?? undefined;
}
