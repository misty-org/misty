import { z } from "zod";
import { apiRequest } from "@/api/client";

/** One time the person @mentioned an agent in Space chat, and how that run went. */
const mentionSchema = z.object({
  state: z.string(),
  request: z.object({
    id: z.string(),
    space_id: z.string(),
    space_name: z.string(),
    target_agent_id: z.string(),
    target_agent_name: z.string(),
    child_run_id: z.string(),
    message: z.string(),
    created_at: z.string(),
  }),
  view: z.object({
    reply: z.string().optional(),
    error: z.string().optional(),
    note: z.string().optional(),
  }),
});
export type AgentMention = z.infer<typeof mentionSchema>;

const stepSchema = z.object({
  name: z.string(),
  state: z.string(),
  error: z.string().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
});
export type AgentMentionStep = z.infer<typeof stepSchema>;

export const agentMentionsApi = {
  /** How an agent got to its reply: steps and outcomes, never inputs. Only the asker may read it. */
  async transcript(requestId: string, signal?: AbortSignal) {
    const body = z.object({ steps: z.array(stepSchema) }).parse(
      await apiRequest<unknown>(`/agent-requests/${encodeURIComponent(requestId)}/transcript`, {
        signal,
      }),
    );
    return body.steps;
  },
  /** The person's own mentions of agents, newest first. Nobody else sees these runs. */
  async list(signal?: AbortSignal) {
    const body = z
      .object({ mentions: z.array(mentionSchema) })
      .parse(await apiRequest<unknown>("/agent-mentions", { signal }));
    return body.mentions;
  },
};
