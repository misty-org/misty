import { currentLessonConversation } from "../lessons/lesson_entry";
import { useDevicePreferences } from "@/features/settings/preference_access";
import { onCall } from "@/features/voice";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  initialCompanionPresentation,
  useCompanionState,
  type CompanionControl,
} from "./companion_state";
import type { CompanionClick } from "./companion_guide";
import { createCompanionControl } from "./cursor_companion_control";
import { CursorCompanionSession } from "./cursor_companion_session";
import { CursorCompanionTypedTurns } from "./cursor_companion_typed";
import { CursorCompanionVoice } from "./cursor_companion_voice";
import { nativeConfiguration } from "./native_configuration";
import { moreHanded, readHanded } from "./tutor_handed";
import { controlEvent, type DisplayCapture } from "./protocol";

const callCheckMs = 5_000;

export function startCursorCompanion(accountId: string) {
  const s = new CursorCompanionSession(accountId);
  const voice = new CursorCompanionVoice(s);
  const typed = new CursorCompanionTypedTurns(s, voice);
  s.pointer.onStep = (step) => void typed.continueGuide(step).catch((e) => s.fail(s.turn, e));
  const stopPreferences = useDevicePreferences.subscribe(s.applyPreferences);
  s.applyPreferences();
  const unsubscribe = useMistyStore.subscribe(() => {
    if (s.conversationScope && !s.creatingConversation && !s.originIsCurrent(s.conversationScope)) {
      s.closeConversationVoice();
      if (!s.owned && s.state.phase !== "idle" && s.state.phase !== "listening")
        s.change({ phase: "idle" });
    }
    s.settle();
    voice.settleDelegatedTask();
  });
  const removers: Promise<() => void>[] = [];
  void listenToNative(s, voice, typed, removers).catch((e) => s.fail(s.turn, e));
  const away = setInterval(() => {
    if (!s.nativeReady || !s.state.sprite || s.state.visible || s.state.phase !== "idle") return;
    void onCall().then((busy) => {
      if (!s.disposed && Boolean(s.state.spriteAway) !== busy) s.change({ spriteAway: busy });
    });
  }, callCheckMs);
  return () => {
    clearInterval(away);
    s.disposed = true;
    s.pointer.cancel();
    stopPreferences();
    unsubscribe();
    s.stopAudio();
    s.closeConversationVoice();
    clearTimeout(s.hideTimer);
    clearTimeout(s.pointTimer);
    for (const remove of removers) void remove.then((fn) => fn());
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
      void current.loadConversations(true, receipt);
    },
  );
  listen<{ taskId: string; reason: string }>("misty://desktop-control-stopped", (event) => {
    const stoppedTurn = s.turn;
    void import("../../runs/local-execution/local_execution").then(
      ({ useLocalExecution, pauseLocalExecution }) => {
        if (useLocalExecution.getState().execution?.taskId !== event.taskId) return;
        if (!s.disposed) s.fail(stoppedTurn, event.reason);
        void pauseLocalExecution(event.taskId);
      },
    );
  });
  useMistyStore.getState().setAccount(accountId);
  listen<{ turn: number; held: boolean }>("misty://cursor-shortcut", (payload) => {
    if (payload.turn < s.turn) return;
    if (payload.held) {
      if (s.state.teach) currentLessonConversation();
      s.recordingOrigin = s.turnOrigin();
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
  listen<{ paths: string[] }>("misty://cursor-drop", (payload) => {
    if (!Array.isArray(payload.paths) || !payload.paths.length) return;
    void readHanded(payload.paths.slice(0, 10))
      .then(({ handed, names, failed }) => {
        if (s.disposed) return;
        if (names.length) {
          s.handed = moreHanded(s.handed, handed);
          s.notice(`Got ${names.join(", ")}. Ask me about it.`);
        } else if (failed.length) s.notice(failed[0]!);
      })
      .catch((error: unknown) => s.notice(String(error)));
  });
  listen("misty://cursor-escape", () => {
    if (s.tour.running) s.tour.stop();
  });
  listen<{ phase: string }>("misty://dictation", (payload) => {
    if (payload.phase === "finish") s.tour.dictated();
  });
  listen<{ turn: number; text: string; images?: string[] }>("misty://cursor-ask", (payload) => {
    if (payload.turn < s.turn || !payload.text.trim()) return;
    const images = (payload.images ?? [])
      .filter((url) => url.startsWith("data:image/"))
      .map((dataUrl) => ({ mimeType: dataUrl.slice(5, dataUrl.indexOf(";")), dataUrl }));
    if (images.length) s.handed = moreHanded(s.handed, { images, texts: [], others: [] });
    s.recordingOrigin = s.turnOrigin();
    s.turn = payload.turn;
    s.captures = [];
    s.invocationId = undefined;
    s.captionNextAnswer = true;
    void s.interrupt(false).catch((e) => s.fail(payload.turn, e));
    s.change({ visible: true, phase: "processing", error: undefined });
    void voice
      .start()
      .submitText(payload.text)
      .catch((e) => s.fail(payload.turn, e));
  });
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
  s.greet();
}
