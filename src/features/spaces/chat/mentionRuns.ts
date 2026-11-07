import { spacesApi } from "@/api/spaces/api";
import type { SpaceMessage } from "@/api/spaces/dto/entities";
import { desktopDeviceGrants } from "@/features/agents/deviceGrants";
import { listPersonalAgents } from "@/features/agents/personalAgentsApi";
import { agentAccountId } from "@/features/agents/agentAccount";
import { aiSurfaceApi, subscribeToAiInvocation } from "@/features/ai-surface/api";
import { followAddress } from "@/features/ai-surface/localRunParts";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { MentionableAgent } from "./store/useSpaceMessageSpansStore";

/**
 * An `@mention` of your own agent runs on your computer,
 * and its reply posts as an ordinary message answering yours. Nobody else can ask your agent to act: a
 * mention of someone else's agent is only text.
 */

const maxAgents = 3;
const startFailed = "couldn't start this. Check Settings › Models and ask again.";

type Span = SpaceMessage["content"][number];

const plainText = (spans: Span[]) =>
  spans
    .map((span) => (span.type === "text" ? (span.text ?? "") : span.label ? `@${span.label}` : ""))
    .join("")
    .trim();

/** The agents in a message that belong to the sender, at most three, each once. */
export function ownMentions(
  spans: Span[],
  agents: readonly MentionableAgent[],
  senderId: string | undefined,
): MentionableAgent[] {
  const ids = [
    ...new Set(
      spans.flatMap((span) =>
        span.type === "mention" && "agent_id" in span && span.agent_id ? [span.agent_id] : [],
      ),
    ),
  ];
  // Ids are each computer's own, so two people's agents can share one: only the sender's counts.
  return ids
    .flatMap((id) => {
      const agent = agents.find((item) => item.agent_id === id && item.owner_user_id === senderId);
      return agent ? [agent] : [];
    })
    .slice(0, maxAgents);
}

/** The run's answer, once it has ended. */
function answerOf(runId: string): Promise<string> {
  return new Promise((done) => {
    let answer = "";
    const stop = subscribeToAiInvocation(followAddress(runId), {
      onEvent: (event) => {
        if (event.type === "assistant.message") answer = event.text;
        if (event.type === "invocation.completed" || event.type === "invocation.canceled") {
          stop();
          done(answer);
        }
        if (event.type === "invocation.failed") {
          stop();
          done(answer || event.error);
        }
      },
      onError: (error) => {
        stop();
        done(answer || error.message);
      },
    });
  });
}

async function answerOne(
  message: SpaceMessage,
  agent: MentionableAgent,
  text: string,
  post: (reply: string) => Promise<unknown>,
) {
  const account = agentAccountId();
  const mine = await listPersonalAgents(account);
  // A Space lists an agent by name, and its row may predate this computer's copy.
  const local =
    mine.find((item) => item.id === agent.agent_id) ??
    mine.find((item) => item.name.toLowerCase() === agent.agent_name.toLowerCase());
  if (!local) return;
  try {
    const created = await aiSurfaceApi.createInvocation({
      mode: "drawer",
      surfaceId: "space.chat",
      trigger: "message",
      prompt: text,
      context: [],
      agentId: local.id,
      spaceId: message.space_id,
      executionMode: "user",
      deviceContexts: await desktopDeviceGrants().catch(() => []),
      idempotencyKey: `mention:${message.id}:${agent.agent_id}`,
    });
    const answer = await answerOf(created.invocationId);
    if (answer.trim()) await post(`${agent.agent_name}: ${answer.trim()}`);
  } catch {
    await post(`${agent.agent_name} ${startFailed}`).catch(() => undefined);
  }
}

/** Starts the sender's mentioned agents, and posts each reply. Never gets in the way of the message. */
export function runOwnMentions(
  message: SpaceMessage,
  agents: readonly MentionableAgent[] | undefined,
  senderId: string | undefined,
): void {
  if (!hasTauriInternals() || !agents?.length) return;
  const text = plainText(message.content);
  const post = (reply: string) => {
    const content: Span[] = [{ type: "text", text: reply }];
    const nonce = `mention_${crypto.randomUUID()}`;
    return message.conversation_id
      ? spacesApi.sendConversationMessage(
          message.space_id,
          message.conversation_id,
          content,
          [],
          [],
          [],
          message.id,
          nonce,
        )
      : spacesApi.sendMessage(message.space_id, content, [], [], [], message.id, nonce);
  };
  for (const agent of ownMentions(message.content, agents, senderId))
    void answerOne(message, agent, text, post);
}
