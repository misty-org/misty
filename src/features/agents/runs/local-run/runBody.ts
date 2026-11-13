import { engineFolder, engineModels, mistyEngine, modelNamed } from "../../engines/enginesApi";
import { effectiveEffort } from "../../conversations/composer/controls/engineOptions";
import { engineModesFor, resolveEngineMode } from "../../engines/engineModes";
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
  /** The engine's own mode id the run starts in, which a sub-run of it inherits. */
  permissionMode: string;
  collaborationMode: AiInvocationRequest["collaborationMode"];
}> {
  const account = agentAccountId();
  const signedIn = isSignedIn();
  const spaceId = input.spaceId ?? "";
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
  // A turn that chooses nothing takes the chat's choice, then its agent's default, read as one of
  // the engine's own modes (an older Ask, Auto, Plan or Bypass maps to the engine's own here).
  const saved = input.permissionMode ?? (state.permissionMode || agent?.default_run_mode || "ask");
  const chosenCollaboration = input.collaborationMode ?? (conversationId ? state.mode : undefined);
  const onEngine = Boolean(agent?.engine && agent.engine !== mistyEngine);
  const mode = resolveEngineMode(
    await engineModesFor(onEngine ? agent?.engine : mistyEngine),
    saved,
    chosenCollaboration === "plan",
  );
  const permissionMode = mode?.id ?? saved;
  // The engine's planning mode is the chat's Plan; a Teach lesson stays one.
  const collaborationMode: AiInvocationRequest["collaborationMode"] =
    chosenCollaboration === "teach" ? "teach" : mode?.kind === "plans" ? "plan" : "act";
  const body: Record<string, unknown> = {
    ...server,
    // Native code reads these from the saved request for as long as the run lasts (`tool_policy.rs`).
    account,
    parent_run_id: input.parentRunId,
    // The engine's own mode, which native code checks against the engine's list and turns into
    // its flags (`engines/modes.rs`); the older name stays for requests without one.
    engine_mode: mode?.id,
    permission_mode: saved,
    collaboration_mode: collaborationMode,
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
    // An agent on an outside engine works in its own folder, which native code decides
    // (`engines/agent_folder.rs`); the Space's folder named here is only what an agent with none
    // yet takes.
    engine:
      agent?.engine && onEngine
        ? {
            id: agent.engine,
            // The composer's choice for this chat wins over the agent's default.
            model: choices.model || agent.engine_model || "",
            // The level the composer shows for that model, which may take fewer than the engine.
            effort: effectiveEffort({
              engine: agent.engine,
              modelId: choices.model || agent.engine_model || "",
              model: modelNamed(
                await engineModels(agent.engine),
                choices.model || agent.engine_model || "",
              ),
              chosen: choices.effort,
              agentEffort: agent.reasoning_effort,
            }),
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
