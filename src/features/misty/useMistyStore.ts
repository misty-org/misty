import type { AiCaptureAttachment } from "@/features/ai-surface/types";
import { assertMistyAvailable, currentMistySpace } from "./availability";
import { requestHostContext } from "./contextBridge";
import { runtimeAgentsApi as agentsApi } from "@/features/agents/agentsRuntime";

import { create } from "zustand";
import { globalMistyError, globalMistyId } from "@/features/global-search/globalMistyActions";
import { globalMistyApi } from "@/features/global-search/globalMistyApi";
import {
  runtimeAiApi as aiSurfaceApi,
  subscribeAgentsInvocation as subscribeToAiInvocation,
} from "@/features/agents/agentsRuntime";

import {
  searchAgents as executeGlobalSearch,
  visualSearchAgents as executeGlobalVisualSearch,
} from "@/features/agents/agentsRuntime";

export { globalSearchContext } from "@/features/global-search/globalSearchContext";
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
  resumeGlobalAgentPolls,
  updateConversation,
} from "@/features/global-search/globalSearchStoreHelpers";
import { createGlobalSearchPanelState } from "@/features/global-search/globalSearchPanelState";
import type { GlobalSearchState } from "@/features/global-search/globalSearchState";
import { conversationForGlobalPrompt } from "@/features/global-search/globalMistyConversationScope";
export type {
  GlobalSearchState,
  MistySubmissionPresentation,
} from "@/features/global-search/globalSearchState";

export const useMistyStore = create<GlobalSearchState>((set, get) => ({
  ...createGlobalSearchPanelState(set, get),
  mode: "ask",
  setAccount: (accountId) => {
    if (get().accountId === accountId) return;
    replaceActiveGlobalInvocationStream();
    createGlobalSearchPanelState(set, get).setAccount(accountId);
    set({
      mode: "ask",
      selectedSpaceId: "",
      targets: [],
      handoff: undefined,
      captureEnabled: false,
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
    const accountId = get().accountId;
    if (!accountId) return;
    set({ conversationsLoading: true });
    try {
      const response = await globalMistyApi.conversations();
      if (get().accountId !== accountId) return;
      const conversations = response.conversations.map(normalizeConversation);
      set({
        conversations,
        activeConversationId: get().activeConversationId || conversations[0]?.id || "",
        conversationsLoading: false,
      });
      resumeGlobalAgentPolls(set, get, conversations);
    } catch {
      if (get().accountId === accountId) set({ conversationsLoading: false });
    }
  },
  newConversation: async (spaceId) => {
    const accountId = get().accountId;
    const conversation = normalizeConversation(
      await globalMistyApi.createConversation("New conversation", spaceId),
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
  bindConversationSpace: async (conversationId, spaceId) => {
    const requestAccount = get().accountId;
    const normalizedSpaceId = spaceId.trim();
    const existing = get().conversations.find((item) => item.id === conversationId);
    if (!existing || !normalizedSpaceId || existing.spaceId === normalizedSpaceId) return;
    if (existing.spaceId && existing.spaceId !== normalizedSpaceId) {
      set({ error: "Start a new conversation to work in a different Space." });
      return;
    }
    if (!existing.remote) {
      if (get().accountId !== requestAccount) return;
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId ? { ...item, spaceId: normalizedSpaceId } : item,
        ),
      });
      return;
    }
    try {
      const bound = await globalMistyApi.bindConversationSpace(conversationId, normalizedSpaceId);
      if (get().accountId !== requestAccount) return;
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId ? { ...item, spaceId: bound.spaceId } : item,
        ),
        error: null,
      });
    } catch (error) {
      if (get().accountId !== requestAccount) return;
      set({ error: globalMistyError(error) });
      throw error;
    }
  },
  selectConversation: (activeConversationId) =>
    set({
      browserRequest: undefined,
      handoff: undefined,
      targets: [],
      selectedSpaceId:
        get().conversations.find((c) => c.id === activeConversationId)?.spaceId ?? "",
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
    set({
      conversations: previousConversations.filter((item) => item.id !== conversationId),
      activeConversationId:
        previousActiveId === conversationId
          ? (previousConversations.find((item) => item.id !== conversationId)?.id ?? "")
          : previousActiveId,
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
        item.id === conversationId ? { ...item, title: normalized } : item,
      ),
      error: null,
    });
    if (!existing.remote) return;
    try {
      const renamed = await globalMistyApi.renameConversation(conversationId, normalized);
      if (get().accountId !== requestAccount) return;
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId ? { ...item, title: renamed.title } : item,
        ),
      });
    } catch (error) {
      if (get().accountId !== requestAccount) return;
      if (get().accountId !== requestAccount) return;
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId ? { ...item, title: existing.title } : item,
        ),
        error: globalMistyError(error),
      });
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
  ) => {
    const normalized = prompt.trim();
    if ((!normalized && !attachments.length) || get().working) return;
    set({ working: true, error: null });
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
    const requestState = origin ? { ...get(), activeConversationId: origin.conversationId } : get();
    const handoff = get().handoff;
    let requestContext = structuredClone(
      origin?.context ?? handoff?.context ?? requestState.context,
    );
    let sourcePaneId = handoff?.paneId;
    const spaceId =
      handoff?.spaceId ||
      requestContext.find((ref) => ref.spaceId)?.spaceId ||
      get().selectedSpaceId ||
      currentMistySpace();
    try {
      await assertMistyAvailable(accountId, spaceId);
      const external =
        get().captureEnabled && (await (await import("./screenContext")).screenStatus()).external;
      if (!origin && !browserRequest && !handoff?.selection && !external) {
        const snapshot = await requestHostContext({
          accountId,
          spaceId,
          targets: get().targets ?? [],
        });
        requestContext = [
          ...requestContext.filter((ref) => ref.source !== "current"),
          ...snapshot.context,
        ];
        selection = snapshot.selection ?? selection;
        sourcePaneId = snapshot.paneId;
      } else if (external && !handoff?.selection) requestContext = [];
      selection = handoff?.selection ?? selection;
      deviceContexts = handoff?.deviceContexts ?? deviceContexts;
      if (!requestContext.some((ref) => ref.kind === "space" && ref.id === spaceId))
        requestContext.push({
          kind: "space",
          id: spaceId,
          title: "Selected Space",
          spaceId,
          privacy: "shared",
          source: "current",
          attached: true,
        });
      if (get().accountId !== accountId) return;
      set({ selectedSpaceId: spaceId });
    } catch (error) {
      if (get().accountId === accountId) set({ working: false, error: globalMistyError(error) });
      return;
    }
    let capture: AiCaptureAttachment | undefined = handoff?.capture;
    try {
      if (
        get().captureEnabled &&
        !handoff?.selection &&
        !browserRequest &&
        (await (await import("./screenContext")).screenStatus()).external
      ) {
        const screen = await (await import("./screenContext")).captureMistyScreen();
        capture = screen.capture;
        if (get().accountId !== accountId) return;
        set({ screenLabel: screen.label });
      }
    } catch (error) {
      if (get().accountId === accountId) set({ working: false, error: globalMistyError(error) });
      return;
    }
    let conversationId: string;
    try {
      conversationId = await conversationForGlobalPrompt(
        () => ({ ...requestState, context: requestContext }),
        normalized,
      );
    } catch (error) {
      if (get().accountId === accountId) set({ working: false, error: globalMistyError(error) });
      return;
    }
    if (get().accountId !== accountId) return;
    const invocationContext = globalAiContext(requestContext);
    const userMessage = { ...conversationMessage("user", "ask", normalized), attachments };
    const assistantMessage = conversationMessage("assistant", "ask", "");
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
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
        mode: "drawer",
        surfaceId: handoff?.surfaceId ?? "global",
        trigger: selection ? "selection" : "message",
        requestedArtifactKind: handoff?.requestedArtifactKind,
        prompt: normalized,
        context: invocationContext,
        attachmentIds: attachments.map((attachment) => attachment.id),
        deviceContexts,
        modelId: get().conversations.find((item) => item.id === conversationId)?.modelId,
        reasoningEffort: get().conversations.find((item) => item.id === conversationId)
          ?.reasoningEffort,
        selection,
        capture,
        ...(conversationId.startsWith("local-") ? {} : { conversationId }),
        idempotencyKey: `global-answer-${globalMistyId()}`,
      });
      if (get().accountId !== accountId) return;
      set({ invocationId: created.invocationId });
      replaceActiveGlobalInvocationStream(
        subscribeToAiInvocation(created.eventsUrl, {
          onEvent: (event) => {
            if (get().accountId !== accountId) return;
            applyGlobalInvocationEvent(set, get, conversationId, assistantMessage.id, event);
            if (event.type === "artifact.proposed" || event.type === "approval.required")
              set({ pendingArtifact: event.artifact, artifactPaneId: sourcePaneId });
            if (event.type === "effect.applied") set({ pendingArtifact: undefined });
            if (sourcePaneId)
              void requestHostContext({
                accountId,
                spaceId,
                targets: [],
                paneId: sourcePaneId,
                event,
              }).catch((error) => set({ error: globalMistyError(error) }));
          },
          onError: (streamError) => {
            if (get().accountId !== accountId) return;
            patchConversationMessage(set, get, conversationId, assistantMessage.id, {
              content: "Misty lost the response stream. You can retry without affecting search.",
              state: "failed",
              retryable: true,
              activity: undefined,
            });
            set({ working: false, error: streamError.message });
          },
        }),
      );
    } catch (error) {
      if (get().accountId !== accountId) return;
      patchConversationMessage(set, get, conversationId, assistantMessage.id, {
        content: "Misty could not start this answer. Ordinary search is still available.",
        state: "failed",
        retryable: true,
        activity: undefined,
      });
      set({ working: false, error: globalMistyError(error) });
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
      patchProposal(set, get, proposalId, { state: "rejected", error: undefined });
    } catch (error) {
      patchProposal(set, get, proposalId, { error: globalMistyError(error) });
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
      patchProposal(set, get, proposalId, { error: globalMistyError(error) });
    }
  },
  confirmAction: async (proposalId) => {
    const located = findProposal(get().conversations, proposalId);
    if (!located) return;
    patchProposal(set, get, proposalId, { state: "running", error: undefined });
    set({ working: true, error: null });
    try {
      await assertMistyAvailable(get().accountId, located.spaceId || get().selectedSpaceId || "");
      const completed = await globalMistyApi.decideProposal(proposalId, true);
      patchProposal(set, get, proposalId, completed);
    } catch (error) {
      patchProposal(set, get, proposalId, { state: "failed", error: globalMistyError(error) });
    } finally {
      set({ working: false });
    }
  },
  rejectAction: (proposalId) => {
    patchProposal(set, get, proposalId, { state: "rejected" });
    void globalMistyApi.decideProposal(proposalId, false).catch(() => undefined);
  },
}));
