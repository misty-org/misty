import {
  runtimeAgentsApi as agentsApi,
  runtimeAiApi as aiSurfaceApi,
  searchAgents as executeGlobalSearch,
  visualSearchAgents as executeGlobalVisualSearch,
  subscribeAgentsInvocation as subscribeToAiInvocation,
} from "@/features/agents/agentsRuntime";
import { betaExecutionMode } from "@/features/agents/betaModes";
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
import { globalMistyApi } from "@/features/global-search/globalMistyApi";
import { conversationForGlobalPrompt } from "@/features/global-search/globalMistyConversationScope";
import { createGlobalSearchPanelState } from "@/features/global-search/globalSearchPanelState";
import type { GlobalSearchState } from "@/features/global-search/globalSearchState";
import {
  announceGlobalPanel,
  applyGlobalInvocationEvent,
  conversationMessage,
  findProposal,
  globalAiContext,
  normalizeConversation,
  patchConversationMessage,
  patchProposal,
  replaceActiveGlobalInvocationStream,
  resumeGlobalAgentWatches,
  stopGlobalAgentWatches,
  updateConversation,
} from "@/features/global-search/globalSearchStoreHelpers";
import { create } from "zustand";
import { assertMistyAvailable } from "./availability";
import { requestHostContext } from "./contextBridge";
export { globalSearchContext } from "@/features/global-search/globalSearchContext";
export type {
  GlobalSearchState,
  MistySubmissionPresentation,
} from "@/features/global-search/globalSearchState";
let submissionEpoch = 0;
export const useMistyStore = create<GlobalSearchState>((set, get) => ({
  ...createGlobalSearchPanelState(set, get),
  mode: "ask",
  executionMode: betaExecutionMode("user"),
  executionModeByAgent: {},
  setAccount: (accountId) => {
    if (get().accountId === accountId) return;
    submissionEpoch++;
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
      pendingArtifact: undefined,
      artifactPaneId: undefined,
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
  loadConversations: async () => {
    const epoch = submissionEpoch;
    const accountId = get().accountId;
    if (!accountId) return;
    set({
      conversationsLoading: true,
    });
    try {
      const response = await globalMistyApi.conversations();
      if (get().accountId !== accountId) return;
      if (get().working || epoch !== submissionEpoch) {
        set({
          conversationsLoading: false,
        });
        return;
      }
      const conversations = response.conversations.map(normalizeConversation);
      const activeConversationId =
        get().activeConversationId || (get().selectedAgentId ? "" : conversations[0]?.id) || "";
      set({
        conversations,
        activeConversationId,
        selectedAgentId:
          conversations.find((item) => item.id === activeConversationId)?.agentId ||
          get().selectedAgentId,
        conversationsLoading: false,
      });
      resumeGlobalAgentWatches(set, get, conversations);
    } catch {
      if (get().accountId === accountId)
        set({
          conversationsLoading: false,
        });
    }
  },
  newConversation: async (_legacySpaceId) => {
    const accountId = get().accountId;
    const conversation = normalizeConversation(
      await globalMistyApi.createConversation(
        "New conversation",
        "",
        get().selectedAgentId || selectedPersonalAgent("")?.id,
      ),
    );
    // A browser handoff can await the server while the user switches accounts.
    // Its response belongs to the original account, including local fallbacks.
    if (get().accountId !== accountId) return conversation.id;
    set({
      conversations: [
        conversation,
        ...get().conversations.filter((item) => item.id !== conversation.id),
      ],
      activeConversationId: conversation.id,
      mode: "ask",
      panel: get().panel === "closed" ? "closed" : "answer",
      query: "",
      context: [],
      browserRequest: undefined,
      error: null,
    });
    return conversation.id;
  },
  // Retained for old entry points; context does not bind AI ownership.
  bindConversationSpace: async () => {},
  selectConversation: (activeConversationId) =>
    set({
      selectedAgentId: get().conversations.find((c) => c.id === activeConversationId)?.agentId,
      browserRequest: undefined,
      handoff: undefined,
      targets: [],
      selectedSpaceId: "",
      activeConversationId,
      mode: "ask",
      panel: get().panel === "closed" ? "closed" : "answer",
      query: "",
      context: [],
      error: null,
    }),
  deleteConversation: async (conversationId) => {
    const requestAccount = get().accountId;
    const existing = get().conversations.find((item) => item.id === conversationId);
    if (!existing) return;
    const previousConversations = get().conversations;
    const previousActiveId = get().activeConversationId;
    const previousAgentId = get().selectedAgentId;
    const nextConversation = previousConversations.find((item) => item.id !== conversationId);
    set({
      conversations: previousConversations.filter((item) => item.id !== conversationId),
      activeConversationId:
        previousActiveId === conversationId ? (nextConversation?.id ?? "") : previousActiveId,
      selectedAgentId:
        previousActiveId === conversationId
          ? (nextConversation?.agentId ?? previousAgentId)
          : previousAgentId,
      context: previousActiveId === conversationId ? [] : get().context,
    });
    if (!existing?.remote) return;
    try {
      await globalMistyApi.deleteConversation(conversationId);
    } catch (error) {
      if (get().accountId !== requestAccount) return;
      set({
        conversations: previousConversations,
        activeConversationId: previousActiveId,
        selectedAgentId: previousAgentId,
        error: globalMistyError(error),
      });
    }
  },
  renameConversation: async (conversationId, title) => {
    const requestAccount = get().accountId;
    const normalized = title.trim().slice(0, 120);
    const existing = get().conversations.find((item) => item.id === conversationId);
    if (!existing || !normalized || normalized === existing.title) return;
    set({
      conversations: get().conversations.map((item) =>
        item.id === conversationId
          ? {
              ...item,
              title: normalized,
            }
          : item,
      ),
      error: null,
    });
    if (!existing.remote) return;
    try {
      const renamed = await globalMistyApi.renameConversation(conversationId, normalized);
      if (get().accountId !== requestAccount) return;
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                title: renamed.title,
              }
            : item,
        ),
      });
    } catch (error) {
      if (get().accountId !== requestAccount) return;
      if (get().accountId !== requestAccount) return;
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                title: existing.title,
              }
            : item,
        ),
        error: globalMistyError(error),
      });
    }
  },
  cancelResponse: async () => {
    submissionEpoch++;
    const accountId = get().accountId;
    const invocationId = get().invocationId;
    await pauseLocalExecution();
    if (invocationId) await aiSurfaceApi.cancelInvocation(invocationId);
    if (get().accountId === accountId && get().invocationId === invocationId) {
      const conversationId = get().activeConversationId;
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
      });
      replaceActiveGlobalInvocationStream();
    }
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
    const normalized = prompt.trim();
    if ((!normalized && !attachments.length) || get().working) return;
    const epoch = ++submissionEpoch;
    set({
      working: true,
      error: null,
      invocationId: undefined,
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
    const handoff = companion ? undefined : get().handoff;
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
      if (get().accountId !== accountId || epoch !== submissionEpoch) return;
      const agent = get().selectedAgentId || selectedPersonalAgent(spaceId || "")?.id;
      if (!agent) throw new Error("Agents could not be loaded. Reopen Misty to retry.");
      set({
        selectedAgentId: agent,
      });
      const external = (await (await import("./screenContext")).screenStatus()).external;
      if (
        !isAgentWorkerWindow() &&
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
      if (get().accountId !== accountId || epoch !== submissionEpoch) return;
      set({
        selectedSpaceId: spaceId,
      });
    } catch (error) {
      if (get().accountId === accountId && epoch === submissionEpoch)
        set({
          working: false,
          error: globalMistyError(error),
        });
      return;
    }
    let capture: AiCaptureAttachment | undefined = companion?.capture ?? handoff?.capture;
    try {
      if (
        !companion &&
        !handoff?.selection &&
        !browserRequest &&
        (await (await import("./screenContext")).screenStatus()).external
      ) {
        const screen = await (await import("./screenContext")).captureMistyScreen();
        capture = screen.capture;
        if (get().accountId !== accountId || epoch !== submissionEpoch) return;
        set({
          screenLabel: screen.label,
        });
      }
    } catch (error) {
      if (get().accountId === accountId && epoch === submissionEpoch)
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
    if (!companion && executionMode === "team" && !isAgentWorkerWindow()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const agent = usePersonalAgentsStore
          .getState()
          .agents.find((a) => a.id === get().selectedAgentId);
        if (!agent) throw new Error("Select an agent first.");
        const conversationId = await conversationForGlobalPrompt(
          () => ({
            ...requestState,
            selectedAgentId: agent.id,
            context: requestContext,
          }),
          normalized,
        );
        if (get().accountId !== accountId || epoch !== submissionEpoch) return;
        await invoke("agent_window_open", {
          request: {
            accountId,
            agentId: agent.id,
            spaceId,
            name: agent.name,
            task: {
              accountId,
              agentId: agent.id,
              spaceId,
              prompt: normalized,
              attachments,
              conversationId,
              context: requestContext,
              capture,
              selection,
            },
          },
        });
        if (get().accountId === accountId && epoch === submissionEpoch)
          set({
            working: false,
            query: "",
            error: null,
            activeConversationId: conversationId,
          });
      } catch (error) {
        if (get().accountId === accountId && epoch === submissionEpoch)
          set({
            working: false,
            error: globalMistyError(error),
          });
      }
      return;
    }
    let executionTaskId: string | undefined;
    if (executionMode !== "user") {
      try {
        const execution = await startLocalExecution(
          accountId,
          get().selectedAgentId!,
          spaceId,
          executionMode === "team" ? "team" : "agent",
          companion
            ? {
                normalTabs: true,
                openWhenMissing:
                  companion.interactionMode === "auto" ||
                  /^(?:(?:please|misty)[, ]+)*(?:(?:can|could|would|will) you (?:please )?)?(?:open|navigate|go to|search|find|book|buy|download|upload|fill|click|do this|do that|take over)\b/i.test(
                    normalized,
                  ),
              }
            : undefined,
        );
        executionTaskId = execution.taskId;
        if (companion?.turn !== undefined) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("cursor_companion_bind_task", {
            turn: companion.turn,
            taskId: execution.taskId,
          });
        }
        if (get().accountId !== accountId || epoch !== submissionEpoch) {
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
    try {
      conversationId = await conversationForGlobalPrompt(
        () => ({
          ...requestState,
          selectedAgentId: get().selectedAgentId,
          context: requestContext,
        }),
        normalized,
      );
    } catch (error) {
      if (executionTaskId) await settleLocalExecution("paused", executionTaskId);
      if (get().accountId === accountId && epoch === submissionEpoch)
        set({
          working: false,
          error: globalMistyError(error),
        });
      return;
    }
    if (get().accountId !== accountId || epoch !== submissionEpoch) {
      if (executionTaskId) await settleLocalExecution("paused", executionTaskId);
      return;
    }
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
      messages: [...conversation.messages, userMessage, assistantMessage],
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
      const created = await aiSurfaceApi.createInvocation({
        agentId:
          get().conversations.find((c) => c.id === conversationId)?.agentId ||
          get().selectedAgentId,
        taskId: executionTaskId,
        executionMode: executionMode ?? "user",
        windowLabel: (await import("@/shared/platform/tauri")).hasTauriInternals()
          ? (await import("@tauri-apps/api/window")).getCurrentWindow().label
          : undefined,
        mode: companion ? "companion" : "drawer",
        companionMode: companion?.interactionMode,
        companionModel: companion?.model,
        displayCaptures: companion?.displayCaptures,
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
        idempotencyKey: `global-answer-${globalMistyId()}`,
      });
      if (
        get().accountId !== accountId ||
        epoch !== submissionEpoch ||
        (executionTaskId &&
          (useLocalExecution.getState().execution?.taskId !== executionTaskId ||
            useLocalExecution.getState().execution?.state !== "running"))
      ) {
        await aiSurfaceApi.cancelInvocation(created.invocationId).catch(() => {});
        return;
      }
      set({
        invocationId: created.invocationId,
      });
      replaceActiveGlobalInvocationStream(
        subscribeToAiInvocation(created.eventsUrl, {
          onEvent: (event) => {
            if (get().accountId !== accountId || epoch !== submissionEpoch) return;
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
            if (event.type === "artifact.proposed" || event.type === "approval.required")
              set({
                pendingArtifact: event.artifact,
                artifactPaneId: sourcePaneId,
              });
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
              epoch !== submissionEpoch ||
              get().invocationId !== created.invocationId
            )
              return;
            patchConversationMessage(set, get, conversationId, assistantMessage.id, {
              content: "Misty lost the response stream. You can retry without affecting search.",
              state: "failed",
              retryable: true,
              activity: undefined,
            });
            set({
              working: false,
              error: streamError.message,
            });
            if (executionTaskId) void settleLocalExecution("paused", executionTaskId);
          },
        }),
      );
    } catch (error) {
      if (get().accountId !== accountId || epoch !== submissionEpoch) return;
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
  submitAgentTask: async (prompt, _paneId, presentation = "panel") =>
    get().submitAnswer(prompt, [], undefined, presentation),
  cancelAgentTask: async (proposalId) => {
    const proposal = findProposal(get().conversations, proposalId);
    if (!proposal?.runId) return;
    try {
      if (proposal.approvalId) {
        await agentsApi.decideApproval(proposal.runId, proposal.approvalId, "deny");
      } else {
        await agentsApi.cancelRun(proposal.runId);
      }
      patchProposal(set, get, proposalId, {
        state: "rejected",
        error: undefined,
      });
    } catch (error) {
      patchProposal(set, get, proposalId, {
        error: globalMistyError(error),
      });
    }
  },
  approveAgentTask: async (proposalId) => {
    const proposal = findProposal(get().conversations, proposalId);
    if (!proposal?.runId || !proposal.approvalId) return;
    try {
      await agentsApi.decideApproval(proposal.runId, proposal.approvalId, "approve");
      patchProposal(set, get, proposalId, {
        state: "running",
        approvalId: undefined,
        error: undefined,
      });
    } catch (error) {
      patchProposal(set, get, proposalId, {
        error: globalMistyError(error),
      });
    }
  },
  confirmAction: async (proposalId) => {
    const located = findProposal(get().conversations, proposalId);
    if (!located) return;
    patchProposal(set, get, proposalId, {
      state: "running",
      error: undefined,
    });
    set({
      working: true,
      error: null,
    });
    try {
      await assertMistyAvailable(get().accountId, located.spaceId || get().selectedSpaceId || "");
      if (located.runId && located.approvalId) {
        await agentsApi.decideApproval(located.runId, located.approvalId, "approve");
        patchProposal(set, get, proposalId, {
          state: "running",
        });
      } else {
        const completed = await globalMistyApi.decideProposal(proposalId, true);
        patchProposal(set, get, proposalId, completed);
      }
    } catch (error) {
      patchProposal(set, get, proposalId, {
        state: "failed",
        error: globalMistyError(error),
      });
    } finally {
      set({
        working: false,
      });
    }
  },
  rejectAction: (proposalId) => {
    const located = findProposal(get().conversations, proposalId);
    patchProposal(set, get, proposalId, {
      state: "rejected",
    });
    if (located?.runId && located?.approvalId) {
      void agentsApi
        .decideApproval(located.runId, located.approvalId, "deny")
        .catch(() => undefined);
    } else {
      void globalMistyApi.decideProposal(proposalId, false).catch(() => undefined);
    }
  },
}));
