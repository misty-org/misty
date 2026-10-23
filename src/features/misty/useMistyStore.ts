import { runtimeAiApi as aiSurfaceApi } from "@/features/agents/AgentsRuntime";
import { finishLocalExecution, pauseLocalExecution } from "@/features/agents/localExecution";
import { createMistyPanelState } from "./mistyPanelState";
import type { MistyState } from "./mistyState";
import { replaceActiveGlobalInvocationStream } from "./mistyStoreHelpers";
import { create } from "zustand";
import { clearUncertainAdmissions } from "./startInvocation";
import { createSubmitAnswer } from "./submitAnswer";
import { settleRun } from "./settleRun";
import { startRunReconciler } from "./runReconciler";
import { resetMistyDraftAttachments } from "./draftAttachments";
import { createMistyConversationActions } from "./mistyConversationActions";
import { persistLocalChats } from "./localChatSync";
import { advanceSubmissionEpoch } from "./mistySubmissionEpoch";
import { resetSteering, steerResponse } from "./mistySteering";

export type { MistyState } from "./mistyState";
export const useMistyStore = create<MistyState>((set, get) => ({
  ...createMistyPanelState(set, get),
  executionMode: "user",
  setAccount: (accountId) => {
    if (get().accountId === accountId) return;
    resetMistyDraftAttachments(accountId);
    advanceSubmissionEpoch();
    resetSteering();
    clearUncertainAdmissions();
    void finishLocalExecution();
    replaceActiveGlobalInvocationStream();
    createMistyPanelState(set, get).setAccount(accountId);
    set({
      selectedAgentId: undefined,
      executionMode: "user",
      selectedSpaceId: "",
      targets: [],
      handoff: undefined,
      thinkingMode: "normal",
      thinkingModeExplicit: false,
      pendingModelOverride: undefined,
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
  ...createMistyConversationActions(set, get),
  submitAgentTask: async (prompt, presentation = "panel") =>
    get().submitAnswer(prompt, [], undefined, presentation),
  cancelResponse: async () => {
    advanceSubmissionEpoch();
    const accountId = get().accountId;
    const invocationId = get().invocationId;
    // Stop shows at once. The local task and server are told after,
    // and none of them failing can leave the chat looking busy.
    settleRun(set, get, { state: "canceled" });
    await pauseLocalExecution().catch(() => {});
    if (invocationId && get().accountId === accountId)
      await aiSurfaceApi.cancelInvocation(invocationId).catch(() => {});
  },
  steerResponse: (text, conversationId) => steerResponse(set, get, text, conversationId),
  submit: async () => get().submitAnswer(get().query),
  submitAnswer: createSubmitAnswer(set, get),
}));

// Every change to a chat is saved on this device (docs/design/agent-chats-local/BRIEF.md).
persistLocalChats((listener) => useMistyStore.subscribe(listener));

startRunReconciler(useMistyStore);
