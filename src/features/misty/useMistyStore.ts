import { openAgentWindow, stopAgentWindowTask } from "@/features/agents/agentWindowHandoff";
import { apiRequest } from "@/api/client";
import { companionRequestsBrowser } from "./companionBrowserIntent";
import {
  runtimeAiApi as aiSurfaceApi,
  searchAgents as executeGlobalSearch,
  visualSearchAgents as executeGlobalVisualSearch,
  subscribeAgentsInvocation as subscribeToAiInvocation,
} from "@/features/agents/AgentsRuntime";
import { betaExecutionMode, visibleAutopilotAvailable } from "@/features/agents/betaModes";
import {
  finishLocalExecution,
  isAgentWorkerWindow,
  pauseLocalExecution,
  settleLocalExecution,
  startLocalExecution,
  useLocalExecution,
} from "@/features/agents/localExecution";
import {
  selectedPersonalAgent,
  usePersonalAgentsStore,
} from "@/features/agents/personalAgentsStore";
import { thinkingEffort, thinkingMode } from "@/features/agents/thinkingMode";
import type { AiCaptureAttachment } from "@/features/ai-surface/types";
import { globalMistyError, globalMistyId } from "@/features/global-search/globalMistyActions";
import { conversationForGlobalPrompt } from "@/features/global-search/globalMistyConversationScope";
import { createGlobalSearchPanelState } from "@/features/global-search/globalSearchPanelState";
import type { GlobalSearchState } from "@/features/global-search/globalSearchState";
import {
  announceGlobalPanel,
  applyGlobalInvocationEvent,
  conversationMessage,
  globalAiContext,
  patchConversationMessage,
  replaceActiveGlobalInvocationStream,
  stopGlobalAgentWatches,
  updateConversation,
} from "@/features/global-search/globalSearchStoreHelpers";
import { create } from "zustand";
import { assertMistyAvailable } from "./availability";
import { requestHostContext } from "./contextBridge";
import { resetMistyDraftAttachments } from "./draftAttachments";
import { createMistyConversationActions } from "./mistyConversationActions";
import { createMistyProposalActions } from "./mistyProposalActions";
import { advanceSubmissionEpoch, submissionEpoch } from "./mistySubmissionEpoch";

export type {
  GlobalSearchState,
  MistySubmissionPresentation,
} from "@/features/global-search/globalSearchState";
const uncertainAdmissions = new Map<string, string>();
let steeringRequest:
  | { accountId: string; invocationId: string; text: string; key: string; pending?: Promise<void> }
  | undefined;
export const useMistyStore = create<GlobalSearchState>((set, get) => ({
  ...createGlobalSearchPanelState(set, get),
  mode: "ask",
  executionMode: betaExecutionMode("user"),
  executionModeByAgent: {},
  setAccount: (accountId) => {
    if (get().accountId === accountId) return;
    resetMistyDraftAttachments(accountId);
    advanceSubmissionEpoch();
    steeringRequest = undefined;
    uncertainAdmissions.clear();
    void stopAgentWindowTask().catch(() => {});
    void finishLocalExecution();
    replaceActiveGlobalInvocationStream();
    stopGlobalAgentWatches();
    createGlobalSearchPanelState(set, get).setAccount(accountId);
    set({
      mode: "ask",
      selectedAgentId: undefined,
      executionMode: betaExecutionMode("user"),
      selectedSpaceId: "",
      targets: [],
      handoff: undefined,
      thinkingMode: "normal",
      thinkingModeExplicit: false,
      invocationId: undefined,
      invocationConversationId: undefined,
      pendingArtifact: undefined,
      artifactPaneId: undefined,
      artifactConversationId: undefined,
      screenLabel: undefined,
    });
  },
  removeContext: (id) =>
    set({
      context: get().context.filter((ref) => ref.id !== id),
      handoff: undefined,
      browserRequest: undefined,
    }),
  search: (query) => executeGlobalSearch(set, get, query),
  visualSearch: (attachmentId, query) => executeGlobalVisualSearch(set, get, attachmentId, query),
  ...createMistyConversationActions(set, get),
  cancelResponse: async () => {
    advanceSubmissionEpoch();
    const accountId = get().accountId;
    const invocationId = get().invocationId;
    await stopAgentWindowTask().catch(() => {});
    await pauseLocalExecution();
    if (invocationId) await aiSurfaceApi.cancelInvocation(invocationId);
    if (get().accountId === accountId && get().invocationId === invocationId) {
      const conversationId = get().invocationConversationId ?? get().activeConversationId;
      updateConversation(set, get, conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.role === "assistant" &&
          (message.state === "pending" || message.state === "streaming")
            ? {
                ...message,
                state: "canceled",
                activity: undefined,
              }
            : message,
        ),
      }));
      set({
        working: false,
        invocationId: undefined,
        invocationConversationId: undefined,
      });
      replaceActiveGlobalInvocationStream();
    }
  },
  steerResponse: async (text, conversationId = get().activeConversationId) => {
    const state = get();
    if (
      !text.trim() ||
      !state.working ||
      !state.invocationId ||
      conversationId !== (state.invocationConversationId ?? state.activeConversationId)
    )
      throw new Error("Open the active task conversation before sending a follow-up.");
    if (
      !steeringRequest ||
      steeringRequest.accountId !== state.accountId ||
      steeringRequest.invocationId !== state.invocationId ||
      steeringRequest.text !== text
    )
      steeringRequest = {
        accountId: state.accountId,
        invocationId: state.invocationId,
        text,
        key: crypto.randomUUID(),
      };
    const request = steeringRequest;
    if (request.pending) return request.pending;
    request.pending = (async () => {
      const receipt = await apiRequest<{ sequence: number }>(
        `/ai/invocations/${encodeURIComponent(request.invocationId)}/steering`,
        { method: "POST", body: JSON.stringify({ text, idempotencyKey: request.key }) },
      );
      if (get().accountId !== request.accountId) return;
      const id = `${request.invocationId}-steering-${receipt.sequence}`;
      updateConversation(set, get, conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.some((m) => m.id === id)
          ? conversation.messages
          : [
              ...conversation.messages,
              {
                ...conversationMessage("user", "ask", text),
                id,
                state: "completed",
                activity: "Queued for the next safe boundary",
              },
            ],
      }));
      if (get().query === text) set({ query: "", error: null });
      if (steeringRequest === request) steeringRequest = undefined;
    })().finally(() => {
      request.pending = undefined;
    });
    return request.pending;
  },
  submit: async () => get().submitAnswer(get().query),
  submitAnswer: async (
    prompt,
    attachments = [],
    selection,
    presentation = "panel",
    deviceContexts = [],
    origin,
    companion,
  ) => {
    const preparationStarted = performance.now();
    const markPreparation = (stage: string) => {
      if (companion)
        console.debug(
          "[companion preparation]",
          stage,
          Math.round(performance.now() - preparationStarted),
        );
    };
    const normalized = prompt.trim();
    if (!normalized && !attachments.length) return;
    if (get().working) {
      if (attachments.length) {
        set({ error: "Keep attachments for the next task; follow-ups can contain text only." });
        return;
      }
      try {
        await get().steerResponse?.(normalized, origin?.conversationId);
      } catch (error) {
        set({ error: globalMistyError(error) });
      }
      return;
    }
    const epoch = advanceSubmissionEpoch();
    set({
      working: true,
      error: null,
      invocationId: undefined,
      invocationConversationId: undefined,
    });
    const browserRequest = get().browserRequest;
    if (browserRequest && !origin) {
      origin = {
        conversationId: browserRequest.conversationId,
        context: structuredClone(browserRequest.context),
      };
      selection = structuredClone(browserRequest.selection);
      deviceContexts = structuredClone(browserRequest.deviceContexts);
    }
    const accountId = get().accountId;
    const requestState = origin
      ? {
          ...get(),
          activeConversationId: origin.conversationId,
        }
      : get();
    let requestAgentId = requestState.selectedAgentId;
    const handoff = companion && get().handoff?.surfaceId !== "files" ? undefined : get().handoff;
    let requestedThinking = thinkingMode(
      requestState.conversations.find((item) => item.id === requestState.activeConversationId)
        ?.reasoningEffort || thinkingEffort(requestState.thinkingMode ?? "normal"),
    );
    let requestContext = structuredClone(origin?.context ?? handoff?.context ?? []);
    let sourcePaneId = handoff?.paneId;
    const spaceId = "";
    try {
      await assertMistyAvailable(accountId, spaceId);
      if (
        usePersonalAgentsStore.getState().accountId !== accountId ||
        !usePersonalAgentsStore.getState().agents.length
      )
        await usePersonalAgentsStore.getState().load(accountId);
      if (get().accountId !== accountId || epoch !== submissionEpoch()) return;
      const agent = requestAgentId || selectedPersonalAgent(spaceId || "")?.id;
      if (!agent) throw new Error("Agents could not be loaded. Reopen Misty to retry.");
      requestAgentId = agent;
      set({
        selectedAgentId: agent,
      });
      // A worker can inspect only its assigned browser; main-screen APIs reject it.
      // Separate work must also remain independent of main-window permissions.
      const external =
        !isAgentWorkerWindow() && (companion?.executionMode ?? get().executionMode) !== "team"
          ? (await (await import("./screenContext")).screenStatus()).external
          : false;
      if (
        !isAgentWorkerWindow() &&
        (companion?.executionMode ?? get().executionMode) !== "team" &&
        !origin &&
        !browserRequest &&
        !handoff?.selection &&
        !external
      ) {
        const snapshot = await requestHostContext({
          accountId,
          spaceId,
          targets: [],
        });
        requestContext = [...snapshot.context];
        selection = snapshot.selection ?? selection;
        sourcePaneId = snapshot.paneId;
      } else if (!companion && external && !handoff?.selection) requestContext = [];
      selection = handoff?.selection ?? selection;
      deviceContexts = handoff?.deviceContexts ?? deviceContexts;
      if (get().accountId !== accountId || epoch !== submissionEpoch()) return;
      set({
        selectedSpaceId: spaceId,
      });
    } catch (error) {
      if (get().accountId === accountId && epoch === submissionEpoch())
        set({
          working: false,
          error: globalMistyError(error),
        });
      return;
    }
    let capture: AiCaptureAttachment | undefined = companion?.capture ?? handoff?.capture;
    markPreparation("context_ready");
    try {
      if (
        !companion &&
        !isAgentWorkerWindow() &&
        get().executionMode !== "team" &&
        !handoff?.selection &&
        !browserRequest &&
        (await (await import("./screenContext")).screenStatus()).external
      ) {
        const screen = await (await import("./screenContext")).captureMistyScreen();
        capture = screen.capture;
        if (get().accountId !== accountId || epoch !== submissionEpoch()) return;
        set({
          screenLabel: screen.label,
        });
      }
    } catch (error) {
      if (get().accountId === accountId && epoch === submissionEpoch())
        set({
          working: false,
          error: globalMistyError(error),
        });
      return;
    }
    if (!companion && get().executionMode !== betaExecutionMode(get().executionMode))
      set({
        executionMode: betaExecutionMode(get().executionMode),
      });
    const executionMode = companion?.executionMode ?? get().executionMode;
    if (companion?.methodVersionId || companion?.executionMode === "team") set({ executionMode });
    let workerReceipt: { invocationId: string; eventsUrl: string } | undefined;
    let routedConversationId: string | undefined;
    if (executionMode === "team" && !isAgentWorkerWindow()) {
      try {
        const agent = usePersonalAgentsStore.getState().agents.find((a) => a.id === requestAgentId);
        if (!agent) throw new Error("Select an agent first.");
        const conversationId = await conversationForGlobalPrompt(
          () => ({
            ...requestState,
            selectedAgentId: agent.id,
            context: requestContext,
          }),
          normalized,
        );
        if (get().accountId !== accountId || epoch !== submissionEpoch()) return;
        const admission = JSON.stringify([
          accountId,
          conversationId,
          normalized,
          attachments.map((a) => a.id),
        ]);
        const key =
          companion?.idempotencyKey ??
          uncertainAdmissions.get(admission) ??
          `agent-window-${globalMistyId()}`;
        uncertainAdmissions.set(admission, key);
        routedConversationId = conversationId;
        workerReceipt = await openAgentWindow(
          {
            queueId: key,
            accountId,
            agentId: agent.id,
            spaceId,
            prompt: normalized,
            attachments,
            conversationId,
            context: requestContext,
            capture,
            selection,
            companion: {
              ...companion,
              executionMode: "team",
              turn: undefined,
              idempotencyKey: key,
            },
          },
          agent.name,
          () => {
            if (get().accountId !== accountId || epoch !== submissionEpoch())
              throw new Error("The task owner changed.");
          },
        );
        uncertainAdmissions.delete(admission);
      } catch (error) {
        if (get().accountId === accountId && epoch === submissionEpoch())
          set({
            working: false,
            error: globalMistyError(error),
          });
        return;
      }
    }
    let executionTaskId: string | undefined;
    if (executionMode !== "user" && !workerReceipt) {
      try {
        const execution = await startLocalExecution(
          accountId,
          requestAgentId!,
          spaceId,
          executionMode === "team" ? "team" : "agent",
          {
            ...(executionMode === "agent" && visibleAutopilotAvailable() && !isAgentWorkerWindow()
              ? { normalTabs: false, desktopControl: true }
              : companion && !isAgentWorkerWindow()
                ? {
                    normalTabs: true,
                    openWhenMissing:
                      companion.interactionMode === "auto" || companionRequestsBrowser(normalized),
                  }
                : { normalTabs: false }),
            method: companion?.methodVersionId
              ? {
                  versionId: companion.methodVersionId,
                  inputs: companion.methodInputs,
                  skillVersionIds: companion.skillVersionIds,
                }
              : undefined,
          },
        );
        executionTaskId = execution.taskId;
        if (companion?.turn !== undefined && !isAgentWorkerWindow()) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("cursor_companion_bind_task", {
            turn: companion.turn,
            taskId: execution.taskId,
          });
        }
        if (get().accountId !== accountId || epoch !== submissionEpoch()) {
          await settleLocalExecution("paused", executionTaskId);
          return;
        }
        requestContext = [
          ...requestContext.filter((ref) => ref.kind !== "browser-tab"),
          ...execution.context,
        ];
        deviceContexts = execution.deviceContexts;
      } catch (error) {
        set({
          working: false,
          error: globalMistyError(error),
        });
        return;
      }
    } else if (useLocalExecution.getState().execution?.state === "running") {
      await settleLocalExecution("paused");
    }
    let conversationId: string;
    markPreparation("execution_ready");
    try {
      conversationId =
        routedConversationId ??
        (await conversationForGlobalPrompt(
          () => ({
            ...requestState,
            selectedAgentId: requestAgentId,
            context: requestContext,
          }),
          normalized,
        ));
    } catch (error) {
      if (executionTaskId) await settleLocalExecution("paused", executionTaskId);
      if (get().accountId === accountId && epoch === submissionEpoch())
        set({
          working: false,
          error: globalMistyError(error),
        });
      return;
    }
    if (get().accountId !== accountId || epoch !== submissionEpoch()) {
      if (executionTaskId) await settleLocalExecution("paused", executionTaskId);
      return;
    }
    markPreparation("conversation_ready");
    // A conversation's resolved defaults apply only when the composer has no
    // explicit choice. Existing conversation choices keep their precedence.
    if (!requestState.thinkingModeExplicit && requestedThinking !== "deep") {
      requestedThinking = thinkingMode(
        get().conversations.find((c) => c.id === conversationId)?.reasoningEffort ||
          thinkingEffort(requestedThinking),
      );
    }
    const invocationContext = globalAiContext(requestContext);
    const userMessage = {
      ...conversationMessage("user", "ask", normalized),
      attachments,
    };
    const assistantMessage = conversationMessage("assistant", "ask", "");
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
      reasoningEffort: thinkingEffort(requestedThinking),
      title: conversation.messages.length ? conversation.title : normalized.slice(0, 56),
      updatedAt: userMessage.createdAt,
      messages: [
        ...conversation.messages,
        ...(companion?.idempotencyKey?.startsWith("voice-") ? [] : [userMessage]),
        assistantMessage,
      ],
    }));
    if (presentation === "workspace") announceGlobalPanel(false);
    set({
      panel: presentation === "workspace" ? "closed" : "answer",
      working: true,
      error: null,
      query: "",
      context: browserRequest?.context ?? [],
    });
    replaceActiveGlobalInvocationStream();
    try {
      const admission = JSON.stringify([
        accountId,
        conversationId,
        normalized,
        attachments.map((a) => a.id),
      ]);
      const idempotencyKey =
        companion?.idempotencyKey ??
        uncertainAdmissions.get(admission) ??
        `global-answer-${globalMistyId()}`;
      uncertainAdmissions.set(admission, idempotencyKey);
      const created =
        workerReceipt ??
        (await aiSurfaceApi.createInvocation({
          agentId:
            get().conversations.find((c) => c.id === conversationId)?.agentId || requestAgentId,
          taskId: executionTaskId,
          executionMode: executionMode ?? "user",
          windowLabel: (await import("@/shared/platform/tauri")).hasTauriInternals()
            ? (await import("@tauri-apps/api/window")).getCurrentWindow().label
            : undefined,
          mode: companion ? "companion" : "drawer",
          companionMode: companion?.interactionMode,
          companionModel: companion?.model,
          displayCaptures: companion?.displayCaptures,
          methodVersionId: companion?.methodVersionId,
          methodInputs: companion?.methodInputs,
          skillVersionIds: companion?.skillVersionIds,
          surfaceId: handoff?.surfaceId ?? "global",
          trigger: selection ? "selection" : "message",
          requestedArtifactKind: handoff?.requestedArtifactKind,
          prompt: normalized,
          context: invocationContext,
          attachmentIds: attachments.map((attachment) => attachment.id),
          deviceContexts,
          thinkingMode: requestedThinking,
          selection,
          capture,
          ...(conversationId.startsWith("local-")
            ? {}
            : {
                conversationId,
              }),
          idempotencyKey,
        }));
      markPreparation("invocation_admitted");
      uncertainAdmissions.delete(admission);
      if (
        get().accountId !== accountId ||
        epoch !== submissionEpoch() ||
        (executionTaskId &&
          (useLocalExecution.getState().execution?.taskId !== executionTaskId ||
            useLocalExecution.getState().execution?.state !== "running"))
      ) {
        await aiSurfaceApi.cancelInvocation(created.invocationId).catch(() => {});
        return;
      }
      if (executionTaskId) {
        const execution = useLocalExecution.getState().execution;
        if (execution?.taskId === executionTaskId)
          useLocalExecution.setState({
            execution: {
              ...execution,
              conversationId,
              method: execution.method
                ? { ...execution.method, invocationId: created.invocationId }
                : undefined,
            },
          });
      }
      patchConversationMessage(set, get, conversationId, assistantMessage.id, {
        invocationId: created.invocationId,
      });
      set({
        invocationId: created.invocationId,
        invocationConversationId: conversationId,
      });
      replaceActiveGlobalInvocationStream(
        subscribeToAiInvocation(created.eventsUrl, {
          onEvent: (event) => {
            if (get().accountId !== accountId || epoch !== submissionEpoch()) return;
            if (get().invocationId !== created.invocationId) return;
            applyGlobalInvocationEvent(set, get, conversationId, assistantMessage.id, event);
            if (
              executionTaskId &&
              event.type === "assistant.status" &&
              event.phase === "awaiting_intervention"
            ) {
              void pauseLocalExecution(executionTaskId);
              set({
                error:
                  event.text ||
                  "The task needs your help. Complete the requested action in its page, then select Resume.",
              });
            }
            if (
              ["invocation.completed", "invocation.failed", "invocation.canceled"].includes(
                event.type,
              )
            ) {
              if (executionTaskId)
                void settleLocalExecution(
                  event.type === "invocation.completed" ? "finished" : "paused",
                  executionTaskId,
                );
              void usePersonalAgentsStore.getState().load(accountId);
            }
            if (event.type === "artifact.proposed" || event.type === "approval.required") {
              patchConversationMessage(set, get, conversationId, assistantMessage.id, {
                artifact: event.artifact,
              });
              set({
                pendingArtifact: event.artifact,
                artifactPaneId: sourcePaneId,
                artifactConversationId: conversationId,
              });
            }
            if (event.type === "effect.applied")
              set({
                pendingArtifact: undefined,
              });
            if (sourcePaneId)
              void requestHostContext({
                accountId,
                spaceId,
                targets: [],
                paneId: sourcePaneId,
                event,
              }).catch((error) =>
                set({
                  error: globalMistyError(error),
                }),
              );
          },
          onError: (streamError) => {
            if (
              get().accountId !== accountId ||
              epoch !== submissionEpoch() ||
              get().invocationId !== created.invocationId
            )
              return;
            patchConversationMessage(set, get, conversationId, assistantMessage.id, {
              content:
                get()
                  .conversations.find((conversation) => conversation.id === conversationId)
                  ?.messages.find((message) => message.id === assistantMessage.id)?.content ||
                "Misty lost the response stream. Review the task before retrying.",
              state: "failed",
              retryable: false,
              activity: "Connection lost; the task may still be running.",
            });
            set({
              working: true,
              error: streamError.message,
            });
            if (executionTaskId) void settleLocalExecution("paused", executionTaskId);
          },
        }),
      );
    } catch (error) {
      if (get().accountId !== accountId || epoch !== submissionEpoch()) return;
      patchConversationMessage(set, get, conversationId, assistantMessage.id, {
        content: "Misty could not start this answer. Ordinary search is still available.",
        state: "failed",
        retryable: true,
        activity: undefined,
      });
      set({
        working: false,
        error: globalMistyError(error),
      });
      if (executionTaskId) void settleLocalExecution("paused", executionTaskId);
    }
  },
  ...createMistyProposalActions(set, get),
}));
