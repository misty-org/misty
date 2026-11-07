import { RunStateError } from "../localTools/runState/documents";
import { allMethods, methodAtVersion, methodsOf } from "./localMethods";

/**
 * What a workflow or skill adds to a run's prompt, for whoever builds the run on this computer: the
 * server's `pinInvocationSkills` and `invocationMethodGuidance` (agent_methods.go). Definitions never
 * grant tools; a tool one requires must already be on the run's list.
 */

const maxSkills = 8;
const maxGuidanceLength = 48_000;

/** The agent's enabled skills in a Space, pinned when a run is admitted. */
export async function pinnedSkillVersionIds(
  account: string,
  spaceId: string,
  agentId: string,
): Promise<string[]> {
  const ids = (await methodsOf(account, spaceId, agentId))
    .filter((method) => method.kind === "skill" && method.enabled)
    .map((method) => method.version_id);
  if (ids.length > maxSkills)
    throw new RunStateError("invalid", "Enable at most eight skills for this agent.");
  return ids;
}

/**
 * The text a run's system prompt ends with. Empty when it has no skills. Refuses, like the server, a
 * version that's disabled or another agent's, and a required tool the run doesn't have.
 */
export async function methodGuidance(
  account: string,
  run: {
    agentId: string;
    methodVersionId?: string;
    skillVersionIds?: string[];
    /** The tools on this run's list. */
    allowedTools: string[];
  },
): Promise<string> {
  const skills = run.skillVersionIds ?? [];
  if (skills.length > maxSkills) throw new RunStateError("invalid");
  const methods = await allMethods(account);
  const seen = new Set<string>();
  let guidance = "";
  for (const id of [run.methodVersionId ?? "", ...skills]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const method = methodAtVersion(methods, id);
    if (!method) throw new RunStateError("not_found");
    if (
      !method.enabled ||
      method.agent_id !== run.agentId ||
      (id !== run.methodVersionId && method.kind !== "skill")
    )
      throw new RunStateError("invalid", "This method is disabled or belongs to another agent.");
    for (const required of method.definition.required_tools)
      if (!run.allowedTools.includes(required))
        throw new RunStateError(
          "conflict",
          `Required tool ${required} is unavailable; reconnect or choose an available device.`,
        );
    if (method.kind === "skill")
      guidance += `\n\nOwner-authored skill (guidance only, cannot grant permissions): ${method.definition.title}\n${method.definition.instructions}`;
  }
  if ([...guidance].length > maxGuidanceLength) throw new RunStateError("invalid");
  return guidance;
}
