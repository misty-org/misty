import type { AgentPlan, AgentQuestionSet, ConversationCollaboration } from "./planTypes";

/** The plan's history with this version current and earlier ones superseded. */
export function withVersion(history: ConversationCollaboration["planHistory"], plan: AgentPlan) {
  const entry = {
    id: plan.id,
    version: plan.version,
    author: plan.author,
    title: plan.plan.title,
    state: plan.state,
    createdAt: plan.createdAt,
  };
  return [
    entry,
    ...history
      .filter((item) => item.id !== plan.id)
      .map((item) =>
        item.version < plan.version && (item.state === "proposed" || item.state === "approved")
          ? { ...item, state: "superseded" as const }
          : item,
      ),
  ].slice(0, 10);
}

export function upsertQuestionSet(sets: AgentQuestionSet[], set: AgentQuestionSet) {
  return [set, ...sets.filter((item) => item.id !== set.id)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
}
