import { agentAccountId, isSignedIn } from "../../personal/agentAccount";
import { memoryPromptContext } from "@/features/agents/localRun";
import {
  blankConversationState,
  collaborationOf,
  readConversationState,
} from "@/features/agents/localRun";
import { computerName } from "@/features/agents/localRun";
import { personalAgentFor } from "../../personal/personalAgentsStore";
import { browserReplayForRun } from "@/features/agents/localRun";
import { methodGuidance, pinnedSkillVersionIds } from "@/features/agents/localRun";
import { invoke } from "@/native/invoke";
import { localAttachmentsForRun } from "../../conversations/composer/localAttachments";
import { spaceWindow } from "@/features/app-windows";
import { toServerInvocation } from "../invocations/serverInvocation";
import type {
  AiInvocationDeviceContext,
  AiInvocationRequest,
} from "../invocations/invocationTypes";
import { inferredArtifactKind } from "./artifactSpecs";
import { resolveContext, type ResolvedSource } from "./resolvedContext";
import { goNow } from "./runIdentity";

/**
 * Everything a run reads to start: the request as the crate's `RunRequest` reads it
 * (`local_prompt/request.rs`), with what the server used to add from its own tables.
 */

const placeholderTitle = "New conversation";

interface ChatFacts {
  title: string | null;
  priorRuns: string[];
}

async function chatFacts(conversationId: string, runId: string): Promise<ChatFacts> {
  const { useMistyStore } = await import("@/features/agents/conversations/state/useMistyStore");
  const chat = useMistyStore.getState().conversations.find((item) => item.id === conversationId);
  const title = chat?.title?.trim();
  // A new chat shows its opening words until a run names it (`openTurn`), which isn't a name yet.
  const opening = chat?.messages.find((message) => message.role === "user")?.content.slice(0, 56);
  return {
    title: title && title !== placeholderTitle && title !== opening?.trim() ? title : null,
    priorRuns: [
      ...new Set(
        (chat?.messages ?? [])
          .flatMap((message) => (message.invocationId ? [message.invocationId] : []))
          .filter((id) => id !== runId),
      ),
    ].reverse(),
  };
}

async function priorWriteReceipts(priorRuns: string[], agentId: string | undefined) {
  if (!agentId || !priorRuns.length) return "";
  const receipts = await invoke<unknown[]>("agent_run_receipts", { runIds: priorRuns }).catch(
    () => [],
  );
  return receipts.length ? JSON.stringify(receipts) : "";
}

async function deviceNames(contexts: AiInvocationDeviceContext[] | undefined) {
  const name = await computerName();
  return Object.fromEntries((contexts ?? []).map((context) => [context.deviceId, name]));
}

/** Which tools a run would have, which a workflow's requirements are checked against. */
const toolsFor = (body: Record<string, unknown>) =>
  invoke<string[]>("agent_run_tools", { body }).catch(() => [] as string[]);

export async function buildRunBody(
  input: AiInvocationRequest,
  runId: string,
  conversationId: string,
): Promise<{
  body: Record<string, unknown>;
  sources: ResolvedSource[];
  requestedKind: string;
  permissionMode: "ask" | "auto";
  collaborationMode: AiInvocationRequest["collaborationMode"];
}> {
  const account = agentAccountId();
  const signedIn = isSignedIn();
  const spaceId = input.spaceId ?? spaceWindow().spaceId ?? "";
  const agentId = input.agentId ?? "";
  const now = Date.now();
  const server = toServerInvocation(input);
  const requestedKind =
    input.requestedArtifactKind ??
    inferredArtifactKind(input.surfaceId, input.prompt, Boolean(input.selection));
  const [chat, state, sources, names, memory, attachments, agent, skills] = await Promise.all([
    chatFacts(conversationId, runId),
    conversationId
      ? readConversationState(account, conversationId)
      : Promise.resolve(blankConversationState("")),
    resolveContext(input.context, signedIn),
    deviceNames(input.deviceContexts),
    memoryPromptContext({ spaceId, agentId }).catch(() => ""),
    localAttachmentsForRun(account, input.attachmentIds ?? []),
    personalAgentFor(account, agentId),
    input.skillVersionIds?.length
      ? Promise.resolve(input.skillVersionIds)
      : pinnedSkillVersionIds(account, spaceId, agentId).catch(() => [] as string[]),
  ]);
  // A turn that chooses nothing takes the chat's choice, then its agent's default.
  const permissionMode =
    input.permissionMode ?? (state.permissionMode || agent?.default_run_mode || "ask");
  const collaborationMode = input.collaborationMode ?? (conversationId ? state.mode : undefined);
  const body: Record<string, unknown> = {
    ...server,
    // Native code reads these from the saved request for as long as the run lasts (`tool_policy.rs`).
    account,
    parent_run_id: input.parentRunId,
    permission_mode: permissionMode,
    requested_artifact_kind: requestedKind || undefined,
    conversation_id: conversationId,
    skill_version_ids: skills,
    now: goNow(server.timezone, new Date(now)),
    signed_in: signedIn,
    composio_key: await composioKeySaved(),
    device_names: names,
    collaboration: collaborationOf(state, now),
    memory_context: memory,
    conversation_title: chat.title,
    agent: agent
      ? { name: agent.name, role: agent.role, instructions: agent.instructions }
      : undefined,
    resolved_context: sources.map(({ kind, title, content }) => ({ kind, title, content })),
    prior_write_receipts: await priorWriteReceipts(chat.priorRuns, input.agentId),
    attachments,
    browser_replay: await browserReplayForRun(
      account,
      input.methodVersionId,
      (input.deviceContexts ?? []).map((context) => ({
        kind: context.kind,
        opaqueRef: context.opaqueRef,
        capabilities: context.capabilities,
      })),
    ),
    ...(import.meta.env.DEV && input.evalTurnLimit ? { eval_turn_limit: input.evalTurnLimit } : {}),
  };
  if (input.methodVersionId || skills.length) {
    body.method_guidance = await methodGuidance(account, {
      agentId,
      methodVersionId: input.methodVersionId,
      skillVersionIds: skills,
      allowedTools: await toolsFor(body),
    });
  }
  return { body, sources, requestedKind, permissionMode, collaborationMode };
}

async function composioKeySaved(): Promise<boolean> {
  const saved = await invoke<string[]>("model_keys_saved").catch(() => [] as string[]);
  return saved.includes("composio");
}
