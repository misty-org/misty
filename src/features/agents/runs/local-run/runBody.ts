import { engineFolder, mistyEngine } from "../../engines/enginesApi";
import { personaInstructions } from "../../personas/catalogApi";
import { assembleAgentPrompt } from "../../bots/botPrompt";
import { takeComputerUseAttachment } from "@/features/computer-use/computerUseAttachment";
import { multirunFolderOf } from "../../multirun/multirunFolders";
import { agentAccountId, isSignedIn } from "../../personal/agentAccount";
import { blankConversationState, collaborationOf, readConversationState } from "../../localRun";
import { computerName } from "../../localRun";
import { personalAgentFor } from "../../personal/personalAgentsStore";
import { invoke } from "@/native/invoke";
import { localAttachmentsForRun } from "../../conversations/composer/localAttachments";
import {
  choicesForTurn,
  takeBrowserAttachment,
} from "../../conversations/composer/controls/composerChoices";
import { spaceWindow } from "@/features/app-windows";
import { toServerInvocation } from "../invocations/serverInvocation";
import type {
  AiInvocationDeviceContext,
  AiInvocationRequest,
} from "../invocations/invocationTypes";
import { inferredArtifactKind } from "./artifactSpecs";
import { resolveContext, type ResolvedSource } from "./resolvedContext";
import { goNow } from "./runIdentity";
import { teammateClaimsNote } from "../../virtual/teammates";
import { useMistyStore } from "../../conversations/state/useMistyStore";

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

export async function buildRunBody(
  input: AiInvocationRequest,
  runId: string,
  conversationId: string,
): Promise<{
  body: Record<string, unknown>;
  sources: ResolvedSource[];
  requestedKind: string;
  permissionMode: "ask" | "auto" | "bypass";
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
  const [chat, state, sources, names, attachments, agent, choices, personas] = await Promise.all([
    chatFacts(conversationId, runId),
    conversationId
      ? readConversationState(account, conversationId)
      : Promise.resolve(blankConversationState("")),
    resolveContext(input.context, signedIn),
    deviceNames(input.deviceContexts),
    localAttachmentsForRun(account, input.attachmentIds ?? []),
    personalAgentFor(account, agentId),
    choicesForTurn(account, conversationId),
    // Personas the message names with `#` from the bundled catalog (`agents/personas`).
    personaInstructions(input.prompt).catch(() => ""),
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
    now: goNow(server.timezone, new Date(now)),
    signed_in: signedIn,
    composio_key: await composioKeySaved(),
    device_names: names,
    collaboration: collaborationOf(state, now),
    conversation_title: chat.title,
    agent:
      agent || personas
        ? {
            name: agent?.name ?? "",
            role: agent?.role ?? "",
            // The agent's soul and rules (`agents/bots`), then any `#` personas.
            instructions: [agent ? assembleAgentPrompt({ agent }).text : "", personas]
              .filter(Boolean)
              .join("\n\n"),
          }
        : undefined,
    // What this run may use: its agent's list. Native code enforces it (`tool_policy.rs`); empty
    // allows every tool.
    allowed_tools: agent?.tools?.length ? agent.tools : undefined,
    // The person sent this with `/computer`: an outside engine gets screen control for it.
    computer_use: input.computerUse || takeComputerUseAttachment(conversationId) || undefined,
    // The person attached Misty's browser to this message; only then does an engine get its tools.
    browser: takeBrowserAttachment(conversationId) || undefined,
    // An agent on an outside engine runs in the Space's linked folder; native code starts it there.
    engine:
      agent?.engine && agent.engine !== mistyEngine
        ? {
            id: agent.engine,
            // The composer's choice for this chat wins over the agent's default.
            model: choices.model || agent.engine_model || "",
            effort: choices.effort || agent.reasoning_effort || "",
            // A multi-run lane's chat works in the lane's own worktree, not the linked folder.
            folder: (await multirunFolderOf(conversationId)) ?? (await engineFolder(spaceId)),
            // A bot's runtime: extra arguments and MCP servers for the engine, by name. Native
            // code decides which it passes.
            args: agent.runtime_args?.length ? agent.runtime_args : undefined,
            mcp_servers: agent.mcp_servers?.length ? agent.mcp_servers : undefined,
            // In a shared Space: the files teammates' agents are changing now, from their run
            // events. Native code puts it before the prompt (`engines/runs.rs`).
            teammates: teammateClaimsNote() || undefined,
          }
        : undefined,
    resolved_context: sources.map(({ kind, title, content }) => ({ kind, title, content })),
    prior_write_receipts: await priorWriteReceipts(chat.priorRuns, input.agentId),
    attachments,
    ...(import.meta.env.DEV && input.evalTurnLimit ? { eval_turn_limit: input.evalTurnLimit } : {}),
  };
  return { body, sources, requestedKind, permissionMode, collaborationMode };
}

async function composioKeySaved(): Promise<boolean> {
  const saved = await invoke<string[]>("model_keys_saved").catch(() => [] as string[]);
  return saved.includes("composio");
}
