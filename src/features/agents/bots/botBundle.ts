// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * One of the person's Misty agents as a bot bundle (a folder of bot.json, SOUL.md and AGENTS.md).
 * Native code writes the folder the person picks (`src-tauri/features/bots`); here the agent's
 * fields map onto the bundle. Misty keeps no memory of its own, so a bundle carries none.
 */
import { invoke } from "@/native/invoke";
import type { AgentProfile } from "@/shared/schemas";

interface BotAvatar {
  type: "generated" | "emoji" | "image";
  value?: string;
  foldShape?: string;
  eyes?: string;
  hue?: number;
  saturation?: number;
  lightness?: number;
}

interface BotBundle {
  id: string;
  slug: string;
  name: string;
  title?: string | null;
  description?: string | null;
  avatar: BotAvatar;
  soul: string;
  instructions: string;
  capabilities: { tools: string[]; mcpServers: string[] };
  runtime: {
    kind: string;
    model?: string | null;
    cwd?: string | null;
    extraArgs: string[];
    permissionMode: "ask" | "auto-safe" | "full";
  };
  builtinId?: string | null;
}

/** Misty's engine ids as ccgui's runtime names. Anything else is written as its engine id. */
const engineToRuntime = (engine?: string) =>
  !engine || engine === "misty" ? "direct" : engine === "claude" ? "claude-code" : engine;

/** The bundle an agent writes out as. */
function bundleFromAgent(agent: AgentProfile): BotBundle {
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
  };
}

/** Writes an agent out as a bot folder where the person picks. The folder's name, or undefined. */
export async function exportBotBundle(agent: AgentProfile): Promise<string | undefined> {
  const folder = await invoke<string | null>("bot_bundle_export", {
    bundle: bundleFromAgent(agent),
  });
  return folder ?? undefined;
}
