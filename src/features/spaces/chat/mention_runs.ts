import { spacesApi } from "../api/api";
import type { SpaceMessage } from "../api/dto/entities";
import { desktopDeviceGrants } from "@/features/agents";
import { listPersonalAgents } from "@/features/agents";
import { agentAccountId } from "@/features/agents";
import { aiSurfaceApi, subscribeToAiInvocation } from "@/features/agents";
import { followAddress } from "@/features/agents";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { MentionableAgent } from "./use_space_message_spans_store";
import { noticeAgentMemoryOnce } from "./agent_memory_notice";
import { messageFromSpaceEvent } from "./use_space_message_spans_store";
import type { SpaceEvent } from "../api/dto/entities";

const maxAgents = 3;
const rememberedLimit = 500;
const ranMessages = new Set<string>();
const awaitingEcho = new Map<string, { agents: readonly MentionableAgent[]; senderId: string }>();

function remember<T>(store: Set<T> | Map<T, unknown>, limit: number) {
  if (store.size <= limit) return;
  const oldest = store.keys().next().value;
  if (oldest !== undefined) store.delete(oldest);
}

export function expectOwnMentions(
  clientNonce: string | undefined,
  agents: readonly MentionableAgent[] | undefined,
  senderId: string | undefined,
): void {
  if (!clientNonce || !senderId || !agents?.length) return;
  awaitingEcho.set(clientNonce, { agents, senderId });
  remember(awaitingEcho, rememberedLimit);
}

if (typeof window !== "undefined")
  window.addEventListener("misty:space-message-event", (event) => {
    const detail = (event as CustomEvent<{ event?: SpaceEvent }>).detail;
    if (detail?.event?.type !== "message.created") return;
    const message = messageFromSpaceEvent(detail.event);
    const waiting = message?.client_nonce ? awaitingEcho.get(message.client_nonce) : undefined;
    if (!message || !waiting) return;
    runOwnMentions(message, waiting.agents, waiting.senderId);
  });
const startFailed = "couldn't start this. Check its engine in Settings › Agents and ask again.";

type Span = SpaceMessage["content"][number];

const plainText = (spans: Span[]) =>
  spans
    .map((span) => (span.type === "text" ? (span.text ?? "") : span.label ? `@${span.label}` : ""))
    .join("")
    .trim();

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
  return ids
    .flatMap((id) => {
      const agent = agents.find((item) => item.agent_id === id && item.owner_user_id === senderId);
      return agent ? [agent] : [];
    })
    .slice(0, maxAgents);
}

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
  const local = mine.find((item) => item.id === agent.agent_id);
  if (!local?.enabled) return;
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

export function runOwnMentions(
  message: SpaceMessage,
  agents: readonly MentionableAgent[] | undefined,
  senderId: string | undefined,
): void {
  if (message.client_nonce) awaitingEcho.delete(message.client_nonce);
  if (!hasTauriInternals() || !agents?.length) return;
  if (!senderId || message.sender_user_id !== senderId) return;
  if (ranMessages.has(message.id)) return;
  const text = plainText(message.content);
  const post = (reply: string) => {
    const content: Span[] = [{ type: "text", text: reply }];
    const nonce = `mention_${crypto.randomUUID()}`;
    const threadRootId = message.thread_root_id ?? "";
    return message.conversation_id
      ? spacesApi.sendConversationMessage(
          message.space_id,
          message.conversation_id,
          content,
          [],
          [],
          message.id,
          nonce,
          "text",
          threadRootId,
        )
      : spacesApi.sendMessage(message.space_id, content, [], [], message.id, nonce, threadRootId);
  };
  const mentioned = ownMentions(message.content, agents, senderId);
  if (!mentioned.length) return;
  ranMessages.add(message.id);
  remember(ranMessages, rememberedLimit);
  void noticeAgentMemoryOnce(message.space_id).catch(() => undefined);
  for (const agent of mentioned) void answerOne(message, agent, text, post);
}
