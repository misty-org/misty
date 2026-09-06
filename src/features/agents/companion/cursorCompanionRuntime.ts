import { assistantApi } from "@/api/assistant/api";
import { useSettingsProfiles } from "@/features/settings/sync";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  initialCompanionPresentation,
  useCompanionState,
  type CompanionControl,
} from "./companionState";
import type { CompanionClick } from "./companionGuide";
import { createCompanionControl } from "./cursorCompanionControl";
import { CursorCompanionSession } from "./cursorCompanionSession";
import { CursorCompanionTypedTurns } from "./cursorCompanionTyped";
import { CursorCompanionVoice } from "./cursorCompanionVoice";
import { nativeConfiguration } from "./nativeConfiguration";
import { controlEvent, type DisplayCapture } from "./protocol";

/** Starts the cursor companion for one account. Returns its teardown. */
export function startCursorCompanion(accountId: string) {
  const s = new CursorCompanionSession(accountId);
  const voice = new CursorCompanionVoice(s);
  const typed = new CursorCompanionTypedTurns(s, voice);
  s.pointer.onStep = (step) => void typed.continueGuide(step).catch((e) => s.fail(s.turn, e));
  const stopPreferences = useSettingsProfiles.subscribe(s.applyPreferences);
  s.applyPreferences();
  const unsubscribe = useMistyStore.subscribe(() => {
    if (s.conversationScope && !s.creatingConversation && !s.originIsCurrent(s.conversationScope))
      s.closeConversationVoice();
    s.settle();
    voice.settleDelegatedTask();
  });
  const removers: Promise<() => void>[] = [];
  void listenToNative(s, voice, typed, removers).catch((e) => s.fail(s.turn, e));
  return () => {
    s.disposed = true;
    s.pointer.cancel();
    stopPreferences();
    unsubscribe();
    s.stopAudio();
    s.closeConversationVoice();
    clearTimeout(s.hideTimer);
    clearTimeout(s.pointTimer);
    for (const remove of removers) void remove.then((fn) => fn());
    // Detaching voice is not a task cancellation. Account changes and lost
    // execution authority are handled by the store and execution lifecycle.
    if (useCompanionState.getState().accountId === accountId)
      useCompanionState.setState({
        accountId: "",
        presentation: initialCompanionPresentation,
        control: undefined,
        submit: undefined,
      });
    void nativeConfiguration("");
  };
}

/** Subscribes to the native companion's events, then configures it for this account. */
async function listenToNative(
  s: CursorCompanionSession,
  voice: CursorCompanionVoice,
  typed: CursorCompanionTypedTurns,
  removers: Promise<() => void>[],
) {
  const accountId = s.accountId;
  const appWindow = getCurrentWindow();
  const listen = <T>(name: string, callback: (payload: T) => void) => {
    removers.push(
      appWindow.listen<T>(name, (event) => {
        if (!s.disposed) callback(event.payload);
      }),
    );
  };
  listen<{ accountId: string; agentId: string; conversationId: string; invocationId: string }>(
    "misty://agent-task-admitted",
    (receipt) => {
      const current = useMistyStore.getState();
      if (
        receipt.accountId !== accountId ||
        current.accountId !== accountId ||
        !receipt.invocationId ||
        !receipt.conversationId ||
        current.selectedAgentId !== receipt.agentId ||
        current.activeConversationId !== receipt.conversationId ||
        current.invocationId === receipt.invocationId ||
        (current.working &&
          (!current.invocationId || current.invocationConversationId !== receipt.conversationId))
      )
        return;
      // A native notice is only a refresh hint. Authenticated history must
      // independently contain this exact agent/conversation/invocation.
      void current.loadConversations(true, receipt);
    },
  );
  listen<{ taskId: string; reason: string }>("misty://desktop-control-stopped", (event) => {
    const stoppedTurn = s.turn;
    void import("../localExecution").then(({ useLocalExecution, pauseLocalExecution }) => {
      if (useLocalExecution.getState().execution?.taskId !== event.taskId) return;
      if (!s.disposed) s.fail(stoppedTurn, event.reason);
      void pauseLocalExecution(event.taskId);
    });
  });
  useMistyStore.getState().setAccount(accountId);
  listen<{ turn: number; held: boolean }>("misty://cursor-shortcut", (payload) => {
    if (payload.turn < s.turn) return;
    if (payload.held) {
      const current = useMistyStore.getState();
      s.recordingOrigin = {
        conversationId: current.activeConversationId,
        agentId: current.selectedAgentId,
      };
      s.turn = payload.turn;
      s.captures = [];
      s.invocationId = undefined;
      void s.interrupt(false).catch((e) => s.fail(payload.turn, e));
      voice.start().begin();
      s.change({
        visible: true,
        phase: "listening",
      });
    } else if (payload.turn === s.turn)
      s.change({
        phase: "processing",
      });
  });
  listen<{ turn: number; captures: DisplayCapture[] }>("misty://cursor-captures", (payload) => {
    if (s.active(payload.turn)) s.captures = payload.captures;
  });
  listen<{ error: string }>("misty://cursor-renderer-error", (payload) =>
    s.fail(s.turn, payload.error),
  );
  listen<{ turn: number; error: string }>("misty://cursor-error", (payload) =>
    s.fail(payload.turn, payload.error),
  );
  listen<{ generation: number }>("misty://cursor-point-finished", (payload) => {
    if (payload.generation === s.turn) {
      s.pointPending = false;
      clearTimeout(s.pointTimer);
      s.change({
        point: undefined,
      });
      s.maybeHide();
    }
  });
  listen("misty://cursor-displays-changed", () => {
    if (s.pointPending) s.pointer.clear();
  });
  listen<CompanionClick>("misty://cursor-click", (payload) => s.pointer.clicked(payload));
  const control = createCompanionControl(s, voice);
  useCompanionState.setState({
    accountId,
    presentation: s.state,
    control,
    submit: typed.submit,
  });
  listen<CompanionControl>(controlEvent, (request) => {
    void control(request).catch((e) => s.fail(s.turn, e));
  });
  listen<{ turn: number; sequence: number; audio: string }>("misty://cursor-audio", (payload) => {
    if (s.active(payload.turn)) s.conversationVoice?.append(payload.sequence, payload.audio);
  });
  listen<{ turn: number; durationMs: number }>("misty://cursor-recorded", (payload) => {
    const generation = payload.turn;
    if (!s.active(generation) || s.recordedTurn === generation) return;
    const origin = s.recordingOrigin;
    s.recordedTurn = generation;
    if (payload.durationMs < 150) {
      s.stopAudio();
      s.change({
        phase: "idle",
      });
      s.maybeHide();
      return;
    }
    s.change({
      phase: "processing",
    });
    const session = s.conversationVoice;
    void (async () => {
      await s.barrier;
      if (!s.active(generation)) return;
      if (!session || !origin || (!s.creatingConversation && !s.originIsCurrent(origin)))
        throw new Error("The voice conversation changed. Hold the shortcut to try again.");
      await session.commit();
    })().catch((error) => {
      if (s.active(generation) && session === s.conversationVoice) {
        s.closeConversationVoice();
        s.change({
          phase: "idle",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });
  await Promise.all(removers);
  if (s.disposed) return;
  s.turn = Math.max(s.turn, await nativeConfiguration(accountId));
  if (s.disposed) return;
  s.nativeReady = true;
  s.change({});
  void assistantApi
    .frontierModels()
    .then((catalog) => {
      if (!s.disposed)
        s.change({
          models: catalog.models.map((m) => ({
            id: m.id,
            name: m.name,
          })),
        });
    })
    .catch(() => {});
}
