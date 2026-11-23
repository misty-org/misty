import { engineModels, mistyEngine, modelNamed, usablePick } from "../../engines/engines_api";
import { effectiveEffort } from "../../conversations/composer/controls/engine_options";
import { defaultEngineId } from "../../engines/engine_run";
import { engineModesFor, resolveEngineMode } from "../../engines/engine_modes";
import { personaInstructions } from "../../personas/catalog_api";
import { assembleAgentPrompt } from "../../bots/bot_prompt";
import { takeComputerUseAttachment } from "@/features/computer-use/computer_use_attachment";
import { multirunFolderOf } from "../../multirun/multirun_folders";
import { continuationNote } from "../../threads/continuation";
import { chatProjectOf, isProjectChat } from "../../shared-folders/chat_folder";
import { agentAccountId, isSignedIn } from "../../personal/agent_account";
import { blankConversationState, collaborationOf, readConversationState } from "../../local_run";
import { computerName } from "../../local_run";
import { personalAgentFor } from "../../personal/personal_agents_store";
import { homeSpaceOf } from "../../personal/agent_home_space";
import { useUserStore } from "@/features/account/core";
import { invoke } from "@/native/invoke";
import { localAttachmentsForRun } from "../../conversations/composer/local_attachments";
import {
  choicesForTurn,
  takeBrowserAttachment,
} from "../../conversations/composer/controls/composer_choices";
import { toServerInvocation } from "../invocations/server_invocation";
import type {
  AiInvocationDeviceContext,
  AiInvocationRequest,
} from "../invocations/invocation_types";
import { inferredArtifactKind } from "./artifact_specs";
import { resolveContext, type ResolvedSource } from "./resolved_context";
import { goNow } from "./run_identity";
import { teammateClaimsNote } from "../../now/teammates";
import { useMistyStore } from "../../conversations/state/use_misty_store";

const placeholderTitle = "New conversation";

interface ChatFacts {
  title: string | null;
  priorRuns: string[];
}

const SCRATCH_CHAT_NOTE =
  "# Where you work\nThis is a chat. You work in its own scratch folder, which is deleted with the " +
  "chat. When the work becomes a project the person will keep (a repository, an app or tool they " +
  "will run again, files that belong together), call the open_in_code tool to offer moving this " +
  "chat into Code, where it gets a project folder of its own, rather than building the project " +
  "here. Never move or copy the files yourself: the person decides.";

async function chatFacts(conversationId: string, runId: string): Promise<ChatFacts> {
  const chat = useMistyStore.getState().conversations.find((item) => item.id === conversationId);
  const title = chat?.title?.trim();
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
  permissionMode: string;
  collaborationMode: AiInvocationRequest["collaborationMode"];
}> {
  const account = agentAccountId();
  const signedIn = isSignedIn();
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
    personaInstructions(input.prompt).catch(() => ""),
  ]);
  const multirunFolder = await multirunFolderOf(conversationId);
  const continued = conversationId ? await continuationNote(conversationId).catch(() => "") : "";
  const inProject =
    Boolean(conversationId) && (multirunFolder !== undefined || isProjectChat(conversationId));
  const saved = input.permissionMode ?? (state.permissionMode || agent?.default_run_mode || "ask");
  const chosenCollaboration = input.collaborationMode ?? (conversationId ? state.mode : undefined);
  const engineId =
    agent?.engine && agent.engine !== mistyEngine
      ? agent.engine
      : input.engineId || (await defaultEngineId().catch(() => "")) || undefined;
  const onEngine = Boolean(engineId);
  const listedModels = engineId ? await engineModels(engineId) : [];
  const modelId = engineId
    ? usablePick(engineId, listedModels, choices.model || agent?.engine_model || "")
    : "";
  const mode = resolveEngineMode(
    await engineModesFor(onEngine ? engineId : mistyEngine),
    saved,
    chosenCollaboration === "plan",
  );
  const permissionMode = mode?.id ?? saved;
  const memorySpace = agent && !agent.system_managed ? homeSpaceOf(account, agent) : "";
  const inThread = Boolean(conversationId && !inProject && engineId && input.spaceId);
  const collaborationMode: AiInvocationRequest["collaborationMode"] =
    chosenCollaboration === "teach" ? "teach" : mode?.kind === "plans" ? "plan" : "act";
  const body: Record<string, unknown> = {
    ...server,
    account,
    parent_run_id: input.parentRunId,
    engine_mode: mode?.id,
    permission_mode: saved,
    collaboration_mode: collaborationMode,
    requested_artifact_kind: requestedKind || undefined,
    conversation_id: conversationId,
    now: goNow(server.timezone, new Date(now)),
    signed_in: signedIn,
    apps_connected: await appsConnected(),
    device_names: names,
    collaboration: collaborationOf(state, now),
    conversation_title: chat.title,
    agent:
      agent || personas
        ? {
            name: agent?.name ?? "",
            role: agent?.role ?? "",
            instructions: [
              agent ? assembleAgentPrompt({ agent }).text : "",
              personas,
              continued,
              conversationId && !inProject && engineId && !inThread ? SCRATCH_CHAT_NOTE : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          }
        : undefined,
    agent_memory:
      memorySpace && engineId && onEngine
        ? { space_id: memorySpace, by: useUserStore.getState().me?.username?.trim() || "" }
        : undefined,
    allowed_tools: agent?.tools?.length ? agent.tools : undefined,
    computer_use: input.computerUse || takeComputerUseAttachment(conversationId) || undefined,
    browser: takeBrowserAttachment(conversationId) || undefined,
    engine:
      engineId && onEngine
        ? {
            id: engineId,
            model: modelId,
            effort: effectiveEffort({
              engine: engineId,
              modelId,
              model: modelNamed(listedModels, modelId),
              chosen: choices.effort,
              agentEffort: agent?.reasoning_effort,
            }),
            folder: multirunFolder ?? chatProjectOf(conversationId),
            space: input.spaceId || undefined,
            thread: inThread
              ? {
                  agent_id: agentId,
                  agent: agent?.name ?? "",
                  title: chat.title || input.prompt.slice(0, 48),
                }
              : undefined,
            args: agent?.runtime_args?.length ? agent.runtime_args : undefined,
            mcp_servers: agent?.mcp_servers?.length ? agent.mcp_servers : undefined,
            teammates: teammateClaimsNote() || undefined,
          }
        : undefined,
    resolved_context: sources.map(({ kind, title, content }) => ({ kind, title, content })),
    prior_write_receipts: await priorWriteReceipts(chat.priorRuns, input.agentId),
    attachments: [
      ...attachments,
      ...(input.images ?? []).map((image, index) => ({
        name: `image-${index + 1}`,
        mime_type: image.mimeType,
        data_url: image.dataUrl,
      })),
    ],
    ...(import.meta.env.DEV && input.evalTurnLimit ? { eval_turn_limit: input.evalTurnLimit } : {}),
  };
  return { body, sources, requestedKind, permissionMode, collaborationMode };
}

async function appsConnected(): Promise<boolean> {
  const apps = await invoke<unknown[]>("direct_apps_list").catch(() => [] as unknown[]);
  return apps.length > 0;
}
