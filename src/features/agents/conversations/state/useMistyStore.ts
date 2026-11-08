import { runtimeAiApi as aiSurfaceApi } from "@/features/agents/AgentsRuntime";
import {
  finishLocalExecution,
  pauseLocalExecution,
} from "../../runs/local-execution/localExecution";
import { createMistyPanelState } from "./mistyPanelState";
import type { MistyState } from "./mistyState";
import { replaceActiveGlobalInvocationStream } from "./mistyStoreUpdates";
import { create } from "zustand";
import { clearUncertainAdmissions } from "../ask/startInvocation";
import { createSubmitAnswer } from "../ask/submitAnswer";
import { settleRun } from "../ask/settleRun";
import { startRunReconciler } from "../ask/runReconciler";
import { resetMistyDraftAttachments } from "../composer/draftAttachments";
import { createMistyConversationActions } from "../ask/mistyConversationActions";
import { persistLocalChats } from "./localChatSync";
import { advanceSubmissionEpoch } from "../ask/mistySubmissionEpoch";
import { conversationInSpace } from "./conversationSpace";
import { onSpaceWindowSwitch } from "@/features/app-windows";
import { resetSteering, steerResponse } from "../ask/mistySteering";

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

// Every change to a chat is saved on this device.
persistLocalChats((listener) => useMistyStore.subscribe(listener));

// A window shows its current Space's conversations; choosing another Space closes one from the last.
onSpaceWindowSwitch((space) => {
  const { activeConversationId, conversations, working } = useMistyStore.getState();
  const open = conversations.find((item) => item.id === activeConversationId);
  if (open && !working && !conversationInSpace(open, space))
    useMistyStore.setState({ activeConversationId: "" });
});

startRunReconciler(useMistyStore);
