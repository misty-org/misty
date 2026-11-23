import { copyAgentToSpace } from "../personal/space_agent_sync";
import { LocalToolRejected, type LocalToolHandler } from "./host";
import { listSpaces, spaceTargets } from "./space/routing";
import { agentAccountId } from "../personal/agent_account";
import { listPersonalAgents, personalAgentsApi } from "../personal/personal_agents_api";
import type { AgentProfile } from "@/shared/schemas";

const invalid = (message: string) => new LocalToolRejected("invalid_request", message);

interface ConfigureInput {
  operation?: unknown;
  agent_id?: unknown;
  version?: unknown;
  name?: unknown;
  role?: unknown;
  description?: unknown;
  instructions?: unknown;
  avatar_emoji?: unknown;
  enabled?: unknown;
  space?: unknown;
}

const textOf = (value: unknown) => (typeof value === "string" ? value : undefined);

const list: LocalToolHandler = async () => ({
  agents: await listPersonalAgents(agentAccountId()),
});

const configure: LocalToolHandler = async (request) => {
  const input = request.input as ConfigureInput;
  const operation = input.operation;
  if (operation !== "create" && operation !== "update" && operation !== "delete")
    throw invalid("The tool arguments are invalid.");
  const agents = await listPersonalAgents(agentAccountId());
  const id = textOf(input.agent_id)?.trim() ?? "";
  const current = agents.find((agent) => agent.id === id);
  if (current?.can_edit === false)
    throw invalid("Only this agent's maker, its Space's owner or a moderator can change it.");
  if (operation === "delete") {
    if (!current) throw invalid("That agent doesn't exist.");
    if (current.system_managed) throw invalid("The default Misty agent can't be deleted.");
    await personalAgentsApi.remove(id);
    return { deleted_agent_id: id };
  }
  if (operation === "update" && !current) throw invalid("That agent doesn't exist.");
  const space = textOf(input.space)?.trim();
  const [target] = space ? spaceTargets(await listSpaces(request), space, "change") : [];
  const base: Partial<AgentProfile> = current ?? {};
  const name = (textOf(input.name) ?? base.name ?? "").trim();
  if (!name) throw invalid("An agent needs a name.");
  const emoji = textOf(input.avatar_emoji);
  const saved = await personalAgentsApi.save(
    {
      name,
      role: textOf(input.role) ?? base.role ?? "",
      description: textOf(input.description) ?? base.description ?? "",
      instructions: textOf(input.instructions) ?? base.instructions ?? "",
      icon: base.icon ?? "",
      avatar: emoji ? { kind: "emoji", emoji } : (base.avatar ?? {}),
      model_mode: base.model_mode ?? "automatic",
      model_id: base.model_id ?? "",
      reasoning_effort: base.reasoning_effort ?? "",
      enabled: typeof input.enabled === "boolean" ? input.enabled : (base.enabled ?? true),
      default_run_mode: base.default_run_mode ?? "ask",
      version: typeof input.version === "number" ? input.version : base.version,
    },
    current?.id,
    current ? {} : { spaceId: target?.id },
  );
  if (!target || saved.space_id === target.id) return { agent: saved };
  const copy = await copyAgentToSpace(saved, target.id);
  return { agent: saved, copied_to_space: target.id, copy_id: copy.id };
};

export const agentTools: Record<string, LocalToolHandler> = {
  "agent.list": list,
  "agent.configure": configure,
};
