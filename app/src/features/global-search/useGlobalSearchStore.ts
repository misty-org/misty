import { agentsApi } from "@/api/agents/api";
import { create } from "zustand";
import {
  globalMistyError,
  globalMistyId,
  normalizeActionState,
  proposeAction,
} from "./globalMistyActions";
import { globalMistyApi } from "./globalMistyApi";
import { mistyIntent } from "./unifiedMistyCandidates";
import { aiSurfaceApi, subscribeToAiInvocation } from "@/features/ai-surface";
import type { GlobalAiActionProposal } from "./types";
import { executeGlobalSearch, executeGlobalVisualSearch } from "./globalSearchExecution";
export { globalSearchContext } from "./globalSearchDocuments";
import {
  announceGlobalPanel,
  applyGlobalInvocationEvent,
  appendConversationMessage,
  askMisty,
  conversationMessage,
  findProposal,
  globalAiContext,
  isTerminalAgentState,
  localConversation,
  normalizeConversation,
  patchConversationMessage,
  patchProposal,
  replaceActiveGlobalInvocationStream,
  resumeGlobalAgentPolls,
  startGlobalAgentTaskPoll,
  updateConversation,
} from "./globalSearchStoreHelpers";
import { createGlobalSearchPanelState } from "./globalSearchPanelState";
import type { GlobalSearchState } from "./globalSearchState";
import { conversationForGlobalPrompt } from "./globalMistyConversationScope";
export type { GlobalSearchState, MistySubmissionPresentation } from "./globalSearchState";

export const useGlobalSearchStore = create<GlobalSearchState>((set, get) => ({
  ...createGlobalSearchPanelState(set, get),
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
    const fallback = localConversation(spaceId);
    let conversation = fallback;
    try {
      conversation = normalizeConversation(
        await globalMistyApi.createConversation("New conversation", spaceId),
      );
    } catch {
      // Older servers keep the conversation in memory for this app session.
    }
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
      error: null,
    });
    return conversation.id;
  },
  bindConversationSpace: async (conversationId, spaceId) => {
    const normalizedSpaceId = spaceId.trim();
    const existing = get().conversations.find((item) => item.id === conversationId);
    if (!existing || !normalizedSpaceId || existing.spaceId === normalizedSpaceId) return;
    if (existing.spaceId && existing.spaceId !== normalizedSpaceId) {
      set({ error: "Start a new conversation to work in a different Space." });
      return;
    }
    if (!existing.remote) {
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId ? { ...item, spaceId: normalizedSpaceId } : item,
        ),
      });
      return;
    }
    try {
      const bound = await globalMistyApi.bindConversationSpace(conversationId, normalizedSpaceId);
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId ? { ...item, spaceId: bound.spaceId } : item,
        ),
        error: null,
      });
    } catch (error) {
      set({ error: globalMistyError(error) });
      throw error;
    }
  },
  selectConversation: (activeConversationId) =>
    set({
      activeConversationId,
      mode: "ask",
      panel: get().panel === "closed" ? "closed" : "answer",
      query: "",
      context: [],
      error: null,
    }),
  deleteConversation: async (conversationId) => {
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
      set({
        conversations: previousConversations,
        activeConversationId: previousActiveId,
        error: globalMistyError(error),
      });
    }
  },
  renameConversation: async (conversationId, title) => {
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
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId ? { ...item, title: renamed.title } : item,
        ),
      });
    } catch (error) {
      set({
        conversations: get().conversations.map((item) =>
          item.id === conversationId ? { ...item, title: existing.title } : item,
        ),
        error: globalMistyError(error),
      });
    }
  },
  submit: async () => {
    const prompt = get().query.trim();
    const mode = get().mode;
    if (!prompt || mode === "search" || get().working) return;
    if (mode === "ask" && mistyIntent(prompt) === "agent") {
      return get().submitAgentTask(prompt);
    }
    const accountId = get().accountId;
    const conversationId = get().activeConversationId || (await get().newConversation());
    const userMessage = conversationMessage("user", mode, prompt);
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
      title: conversation.messages.length ? conversation.title : prompt.slice(0, 56),
      updatedAt: userMessage.createdAt,
      messages: [...conversation.messages, userMessage],
    }));
    set({ working: true, error: null, query: "" });
    try {
      if (mode === "ask") {
        const message = await askMisty(conversationId, prompt, get().context, get().results);
        if (get().accountId !== accountId) return;
        appendConversationMessage(set, get, conversationId, message);
      } else {
        const localProposal = proposeAction(prompt);
        let proposal = localProposal;
        try {
          const response = await globalMistyApi.turn(conversationId, {
            mode: "action",
            prompt,
            context: get().context.filter((item) => !item.localPath || item.attached),
          });
          if (response.action) proposal = { ...localProposal, ...response.action };
        } catch {
          // Compatibility path: the existing delegation endpoint still executes the proposal.
        }
        appendConversationMessage(
          set,
          get,
          conversationId,
          conversationMessage("assistant", "action", proposal.summary, proposal),
        );
        if (!proposal.requiresConfirmation) void get().confirmAction(proposal.id);
      }
    } catch (error) {
      if (get().accountId === accountId) set({ error: globalMistyError(error) });
    } finally {
      if (get().accountId === accountId) set({ working: false });
    }
  },
  submitAnswer: async (
    prompt,
    attachments = [],
    selection,
    presentation = "panel",
    deviceContexts = [],
  ) => {
    const normalized = prompt.trim();
    if ((!normalized && !attachments.length) || get().working) return;
    const accountId = get().accountId;
    let conversationId: string;
    try {
      conversationId = await conversationForGlobalPrompt(get, normalized);
    } catch (error) {
      if (get().accountId === accountId) set({ error: globalMistyError(error) });
      return;
    }
    if (get().accountId !== accountId) return;
    const invocationContext = globalAiContext(get().context);
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
      context: [],
    });
    replaceActiveGlobalInvocationStream();
    try {
      const created = await aiSurfaceApi.createInvocation({
        mode: "drawer",
        surfaceId: "global",
        trigger: "message",
        prompt: normalized,
        context: invocationContext,
        attachmentIds: attachments.map((attachment) => attachment.id),
        deviceContexts,
        modelId: get().conversations.find((item) => item.id === conversationId)?.modelId,
        reasoningEffort: get().conversations.find((item) => item.id === conversationId)
          ?.reasoningEffort,
        selection,
        ...(conversationId.startsWith("local-") ? {} : { conversationId }),
        idempotencyKey: `global-answer-${globalMistyId()}`,
      });
      if (get().accountId !== accountId) return;
      replaceActiveGlobalInvocationStream(
        subscribeToAiInvocation(created.eventsUrl, {
          onEvent: (event) =>
            applyGlobalInvocationEvent(set, get, conversationId, assistantMessage.id, event),
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
  submitAgentTask: async (prompt, paneId = "global", presentation = "panel") => {
    const normalized = prompt.trim();
    if (!normalized || get().working) return;
    const accountId = get().accountId;
    let conversationId: string;
    try {
      conversationId = await conversationForGlobalPrompt(get, normalized);
    } catch (error) {
      if (get().accountId === accountId) set({ error: globalMistyError(error) });
      return;
    }
    if (get().accountId !== accountId) return;
    const invocationContext = globalAiContext(get().context);
    const userMessage = conversationMessage("user", "action", normalized);
    const pending = proposeAction(normalized);
    pending.state = "running";
    const actionMessage = conversationMessage("assistant", "action", pending.summary, pending);
    actionMessage.state = "pending";
    updateConversation(set, get, conversationId, (conversation) => ({
      ...conversation,
      title: conversation.messages.length ? conversation.title : normalized.slice(0, 56),
      updatedAt: userMessage.createdAt,
      messages: [...conversation.messages, userMessage, actionMessage],
    }));
    if (presentation === "workspace") announceGlobalPanel(false);
    set({
      panel: presentation === "workspace" ? "closed" : "agent",
      working: true,
      error: null,
      query: "",
      context: [],
    });
    try {
      let context = invocationContext;
      let primary = context.find((item) => item.spaceId) ?? context[0];
      if (!primary && pending.spaceId) {
        context = [
          {
            kind: "space",
            id: pending.spaceId,
            title: pending.spaceName || "Current Space",
            privacy: "shared",
            spaceId: pending.spaceId,
            href: `/spaces/${encodeURIComponent(pending.spaceId)}`,
          },
        ];
        primary = context[0];
      }
      const created = await aiSurfaceApi.createRun({
        prompt: normalized,
        surfaceId: "global",
        paneId,
        ...(conversationId.startsWith("local-") ? {} : { conversationId }),
        spaceId: primary?.spaceId ?? pending.spaceId,
        href: primary?.href,
        title: primary?.title,
        context,
        idempotencyKey: `global-agent-${globalMistyId()}`,
      });
      if (get().accountId !== accountId) return;
      if (created.routing?.needs_clarification) {
        patchConversationMessage(set, get, conversationId, actionMessage.id, {
          content: created.routing.question || "Misty needs a little more context to continue.",
          state: "completed",
          action: { ...pending, state: "proposed" },
        });
      } else {
        const state = normalizeActionState(created.run?.state ?? created.status);
        patchConversationMessage(set, get, conversationId, actionMessage.id, {
          content:
            state === "completed"
              ? "Misty finished the task. It remains available in your work history."
              : "Misty started the work. You can close this window while it runs.",
          action: {
            ...pending,
            state,
            runId: created.run?.id,
            resultHref: created.agents_href,
            error: created.run?.error_message,
          },
          state: isTerminalAgentState(state)
            ? state === "failed"
              ? "failed"
              : "completed"
            : "pending",
          retryable: state === "failed",
        });
        if (created.run?.id && !isTerminalAgentState(state)) {
          startGlobalAgentTaskPoll(set, get, conversationId, actionMessage.id, created.run.id);
        }
      }
    } catch (error) {
      if (get().accountId !== accountId) return;
      patchConversationMessage(set, get, conversationId, actionMessage.id, {
        content: "Misty could not route this task.",
        state: "failed",
        retryable: true,
        action: { ...pending, state: "failed", error: globalMistyError(error) },
      });
      set({ error: globalMistyError(error) });
    } finally {
      if (get().accountId === accountId) set({ working: false });
    }
  },
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
      let completed: Partial<GlobalAiActionProposal>;
      try {
        const remote = await globalMistyApi.decideProposal(proposalId, true);
        completed = remote;
      } catch {
        const conversationId = get().activeConversationId;
        const response = await aiSurfaceApi.createRun({
          prompt: located.prompt,
          surfaceId: "global",
          paneId: "misty",
          ...(conversationId && !conversationId.startsWith("local-") ? { conversationId } : {}),
          spaceId: located.spaceId,
          context: globalAiContext(get().context),
          idempotencyKey: `confirmed-${located.id}`,
        });
        completed = {
          state: normalizeActionState(response.run?.state ?? response.status),
          runId: response.run?.id,
          error: response.run?.error_message,
        };
      }
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
