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
import { placeUnplacedChats } from "./conversationSpace";
import { onSpaceWindowSwitch, personalSpaceId, useSpaceWindowStore } from "@/features/app-windows";
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

// Chats saved before they carried their Space were made in the personal Space. Once its id is
// known they are given it, and the change is saved like any other.
function placeOldChats() {
  const personalId = personalSpaceId();
  const { accountId, conversations } = useMistyStore.getState();
  if (!personalId || useSpaceWindowStore.getState().personalSpaceOwner !== accountId) return;
  const placed = placeUnplacedChats(conversations, personalId);
  if (placed !== conversations) useMistyStore.setState({ conversations: placed });
}
useSpaceWindowStore.subscribe((state, previous) => {
  if (state.personalSpaceOwner !== previous.personalSpaceOwner) placeOldChats();
});
useMistyStore.subscribe((state, previous) => {
  if (state.conversations !== previous.conversations) placeOldChats();
});

// A chat keeps its own Space whichever the window shows; a new chat not yet sent follows the window.
onSpaceWindowSwitch(() => useMistyStore.setState({ draftSpaceId: undefined }));

startRunReconciler(useMistyStore);
