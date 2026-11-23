import { runtimeAiApi as aiSurfaceApi } from "@/features/agents/agents_runtime";
import {
  finishLocalExecution,
  pauseLocalExecution,
} from "../../runs/local-execution/local_execution";
import { createMistyPanelState } from "./misty_panel_state";
import type { MistyState } from "./misty_state";
import { replaceActiveGlobalInvocationStream } from "./misty_store_updates";
import { create } from "zustand";
import { clearUncertainAdmissions } from "../ask/start_invocation";
import { createSubmitAnswer } from "../ask/submit_answer";
import { settleRun } from "../ask/settle_run";
import { startRunReconciler } from "../ask/run_reconciler";
import { resetMistyDraftAttachments } from "../composer/draft_attachments";
import { createMistyConversationActions } from "../ask/misty_conversation_actions";
import { persistLocalChats } from "./local_chat_sync";
import { advanceSubmissionEpoch } from "../ask/misty_submission_epoch";
import { placeUnplacedChats } from "./conversation_space";
import { onSpaceWindowSwitch, personalSpaceId, useSpaceWindowStore } from "@/features/app-windows";
import { resetSteering, steerResponse } from "../ask/misty_steering";

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
  cancelResponse: async () => {
    advanceSubmissionEpoch();
    const accountId = get().accountId;
    const invocationId = get().invocationId;
    settleRun(set, get, { state: "canceled" });
    await pauseLocalExecution().catch(() => {});
    if (invocationId && get().accountId === accountId)
      await aiSurfaceApi.cancelInvocation(invocationId).catch(() => {});
  },
  steerResponse: (text, conversationId) => steerResponse(set, get, text, conversationId),
  submit: async () => get().submitAnswer(get().query),
  submitAnswer: createSubmitAnswer(set, get),
}));

persistLocalChats((listener) => useMistyStore.subscribe(listener));

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

onSpaceWindowSwitch(() => useMistyStore.setState({ draftSpaceId: undefined }));

startRunReconciler(useMistyStore);
