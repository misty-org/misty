import {
  useSettingsProfiles,
  effectiveValues,
  writeProfilePreference,
} from "@/features/settings/sync";
import { assistantApi } from "@/api/assistant/api";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { companionReply, resolvePoint } from "./companionReply";
import { companionStage } from "./companionStage";
import { CompanionVoice } from "./companionVoice";
import { companionSizeDefault, normalizeCompanionSize } from "./companionSize";
import {
  initialCompanionPresentation,
  useCompanionState,
  type CompanionControl,
  type CompanionSubmission,
} from "./companionState";
import { controlEvent, type DisplayCapture, type Presentation } from "./protocol";
import { nativeConfiguration } from "./nativeConfiguration";
/** Lives only in the signed-in main window. Overlay webviews never receive auth or provider clients. */
export function CursorCompanionController({ accountId }: { accountId: string }) {
  useEffect(() => {
    if (!hasTauriInternals() || !/Mac|Win/.test(navigator.platform)) return;
    let disposed = false,
      turn = 0,
      owned = false,
      pointPending = false,
      voicePending = false;
    let nativeReady = false;
    let barrier = Promise.resolve();
    let abort: AbortController | undefined;
    let voice: CompanionVoice | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let pointTimer: ReturnType<typeof setTimeout> | undefined;
    let speechRetry: string | undefined;
    const preferenceKey = `misty.cursor-companion:${accountId}`;
    let show = true,
      ask = false,
      model = "",
      size = companionSizeDefault;
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
      show = saved.visible !== false;
      ask = saved.ask === true;
      size = normalizeCompanionSize(saved.size);
      model = typeof saved.model === "string" ? saved.model : "";
    } catch {
      /* defaults */
    }
    let state: Presentation = {
      generation: 0,
      phase: "idle",
      visible: show,
      showCompanion: show,
      mode: "auto",
      ask,
      model,
      size,
    };
    const active = (generation: number) =>
      !disposed && turn === generation && useMistyStore.getState().accountId === accountId;
    const publish = () => {
      if (disposed) return;
      useCompanionState.setState({
        accountId,
        presentation: state,
      });
      const published = state;
      if (nativeReady)
        void invoke("cursor_companion_present", {
          turn,
          presentation: published,
        }).catch((reason) => {
          if (!disposed && active(published.generation))
            useCompanionState.setState({
              presentation: {
                ...state,
                error: String(reason),
              },
            });
        });
    };
    const change = (patch: Partial<Presentation>) => {
      state = {
        ...state,
        ...patch,
        generation: turn,
        enabled: nativeReady,
        showCompanion: show,
      };
      publish();
    };
    const applyPreferences = () => {
      const settings = useSettingsProfiles.getState();
      if (settings.accountId !== accountId || !settings.state) return;
      const values = effectiveValues(settings.state);
      show = values["agents.companion.visible"] !== false;
      change({
        visible: show || state.phase !== "idle" || pointPending,
        size: normalizeCompanionSize(values["agents.companion.size"]),
        ask: values["agents.companion.ask"] === true,
        model:
          typeof values["agents.companion.model"] === "string"
            ? values["agents.companion.model"]
            : "",
      });
    };
    const stopPreferences = useSettingsProfiles.subscribe(applyPreferences);
    applyPreferences();
    const maybeHide = () => {
      if (
        state.error ||
        voicePending ||
        pointPending ||
        state.phase === "listening" ||
        state.phase === "processing"
      )
        return;
      const expected = turn;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (active(expected) && !show && !state.error)
          change({
            visible: false,
          });
      }, 1000);
    };
    const stopAudio = () => {
      abort?.abort();
      abort = undefined;
      voice?.close();
      voice = undefined;
      voicePending = false;
    };
    const interrupt = () => {
      speechRetry = undefined;
      stopAudio();
      clearTimeout(hideTimer);
      clearTimeout(pointTimer);
      pointPending = false;
      const shouldCancel = owned;
      owned = false;
      change({
        point: undefined,
        phase: "idle",
        error: nativeReady ? undefined : state.error,
      });
      // Serialize cancellation with the next admission; never cancel an unrelated drawer turn.
      barrier = barrier
        .catch(() => {})
        .then(async () => {
          if (shouldCancel && !disposed && useMistyStore.getState().accountId === accountId)
            await useMistyStore.getState().cancelResponse?.();
        });
      return barrier;
    };
    const fail = (generation: number, reason: unknown) => {
      if (!active(generation)) return;
      void interrupt();
      change({
        phase: "idle",
        point: undefined,
        error: reason instanceof Error ? reason.message : String(reason),
      });
      void invoke<number>("cursor_companion_interrupt", {
        expectedTurn: generation,
      })
        .then((next) => {
          if (active(generation)) {
            turn = next;
            change({});
            maybeHide();
          }
        })
        .catch(() => {});
      maybeHide();
    };
    const interruptNative = async () => {
      const previous = turn;
      const next = nativeReady
        ? await invoke<number>("cursor_companion_interrupt", {
            expectedTurn: previous,
          })
        : previous;
      if (!active(previous)) return false;
      turn = next;
      await interrupt();
      // The Agents composer shares this mode; stop its typed invocation as well.
      if (active(next) && useMistyStore.getState().working)
        await useMistyStore.getState().cancelResponse?.();
      return active(next);
    };
    const speechFailed = (id: string, generation: number, reason: unknown) => {
      if (!active(generation)) return;
      stopAudio();
      speechRetry = id;
      change({
        phase: "idle",
        visible: true,
        error: `The answer is saved in the conversation. Speech failed: ${reason instanceof Error ? reason.message : String(reason)}`,
      });
      // Pointing has independent ownership and can finish even when TTS fails.
    };
    const startVoice = (generation: number, signal: AbortSignal) =>
      new CompanionVoice({
        signal,
        assertCurrent: () => {
          if (!active(generation)) throw new Error("Voice turn cancelled.");
        },
        onPlaying: () => {
          if (active(generation)) change({ phase: "responding" });
        },
        onError: (reason) => {
          if (voicePending && invocationId) speechFailed(invocationId, generation, reason);
          else if (owned && active(generation)) {
            stopAudio();
            change({
              error:
                "Voice disconnected. Your task is still running; its answer will appear in the conversation.",
            });
          } else fail(generation, reason);
        },
      });
    const speak = async (id: string, generation: number) => {
      speechRetry = undefined;
      voicePending = true;
      const controller = abort ?? new AbortController();
      abort = controller;
      try {
        change({ phase: "processing" });
        voice ??= startVoice(generation, controller.signal);
        await voice.speak(id);
        if (!active(generation)) return;
        stopAudio();
        change({ phase: "idle" });
        maybeHide();
      } catch (error) {
        if (!controller.signal.aborted) speechFailed(id, generation, error);
      }
    };
    let captures: DisplayCapture[] = [];
    let recordedTurn = -1;
    let submittedTurn = 0,
      invocationId: string | undefined;
    let submittedConversationId: string | undefined;
    const settle = () => {
      if (!owned || !invocationId || !active(submittedTurn)) return;
      const current = useMistyStore.getState();
      if (!current.working && current.error) {
        owned = false;
        fail(submittedTurn, current.error);
        return;
      }
      if (current.invocationId !== invocationId) return;
      if (current.working) return;
      owned = false;
      const reply = current.conversations
        .find((c) => c.id === submittedConversationId)
        ?.messages.slice()
        .reverse()
        .find((m) => m.role === "assistant");
      if (current.error || reply?.state !== "completed") {
        fail(
          submittedTurn,
          current.error || "The response stopped. Hold the shortcut to try again.",
        );
        return;
      }
      const parsed = companionReply(reply.content);
      const point = resolvePoint(parsed.point, captures);
      pointPending = !!point;
      change({
        phase: "idle",
        point,
      });
      if (point) {
        const expected = turn;
        // Handles display removal or an overlay reload before its animation completion event.
        pointTimer = setTimeout(() => {
          if (active(expected)) {
            pointPending = false;
            change({
              point: undefined,
            });
            maybeHide();
          }
        }, 15_000);
      }
      void speak(invocationId, submittedTurn);
    };
    const capture = (generation: number, signal: AbortSignal) =>
      companionStage(
        invoke<DisplayCapture[]>("cursor_companion_capture", { turn: generation }),
        signal,
        "Screen capture",
        20_000,
      );
    const submitCaptured = async (
      request: CompanionSubmission,
      generation: number,
      screens: DisplayCapture[],
      signal: AbortSignal,
    ) => {
      if (!active(generation)) return;
      captures = screens;
      submittedTurn = generation;
      owned = true;
      await companionStage(
        useMistyStore.getState().submitAnswer(
          request.prompt,
          request.attachments ?? [],
          undefined,
          "workspace",
          [],
          { conversationId: request.conversationId, context: [] },
          {
            turn: generation,
            executionMode: "agent",
            interactionMode: state.mode,
            displayCaptures: screens,
            model: state.model,
          },
        ),
        signal,
        "Starting the response",
        60_000,
      );
      if (!active(generation)) return;
      const current = useMistyStore.getState();
      invocationId = current.invocationId;
      submittedConversationId = current.activeConversationId;
      if (!invocationId) {
        owned = false;
        throw new Error(current.error || "The companion could not start. Please try again.");
      }
      settle();
    };
    const submit = async (request: CompanionSubmission) => {
      if (!nativeReady) throw new Error("The companion is starting. Try again in a moment.");
      if (useMistyStore.getState().working)
        throw new Error("Stop the current response before sending another request.");
      if (!(await interruptNative())) return;
      const generation = turn;
      invocationId = undefined;
      captures = [];
      change({ visible: true, phase: "processing", error: undefined });
      const controller = new AbortController();
      abort = controller;
      try {
        const screens = await capture(generation, controller.signal);
        await submitCaptured(request, generation, screens, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) fail(generation, error);
        throw error;
      }
    };
    const unsubscribe = useMistyStore.subscribe(settle);
    const removers: Promise<() => void>[] = [];
    const window = getCurrentWindow();
    const listen = <T,>(name: string, callback: (payload: T) => void) => {
      removers.push(
        window.listen<T>(name, (event) => {
          if (!disposed) callback(event.payload);
        }),
      );
    };
    const setup = async () => {
      listen<{ taskId: string; reason: string }>("misty://desktop-control-stopped", (event) => {
        const stoppedTurn = turn;
        void import("../localExecution").then(({ useLocalExecution, pauseLocalExecution }) => {
          if (useLocalExecution.getState().execution?.taskId !== event.taskId) return;
          if (!disposed) fail(stoppedTurn, event.reason);
          void pauseLocalExecution(event.taskId);
        });
      });
      useMistyStore.getState().setAccount(accountId);
      listen<{
        turn: number;
        held: boolean;
      }>("misty://cursor-shortcut", (payload) => {
        if (payload.turn < turn) return;
        if (payload.held) {
          turn = payload.turn;
          captures = [];
          invocationId = undefined;
          void interrupt().catch((e) => fail(payload.turn, e));
          const controller = new AbortController();
          abort = controller;
          voice = startVoice(payload.turn, controller.signal);
          change({
            visible: true,
            phase: "listening",
          });
        } else if (payload.turn === turn)
          change({
            phase: "processing",
          });
      });
      listen<{
        turn: number;
        captures: DisplayCapture[];
      }>("misty://cursor-captures", (payload) => {
        if (active(payload.turn)) captures = payload.captures;
      });
      listen<{
        error: string;
      }>("misty://cursor-renderer-error", (payload) => fail(turn, payload.error));
      listen<{
        turn: number;
        error: string;
      }>("misty://cursor-error", (payload) => fail(payload.turn, payload.error));
      listen<{
        generation: number;
      }>("misty://cursor-point-finished", (payload) => {
        if (payload.generation === turn) {
          pointPending = false;
          clearTimeout(pointTimer);
          change({
            point: undefined,
          });
          maybeHide();
        }
      });
      listen("misty://cursor-displays-changed", () => {
        if (pointPending) {
          pointPending = false;
          change({
            point: undefined,
          });
          maybeHide();
        }
      });
      const control = async (control: CompanionControl) => {
        if (disposed || useMistyStore.getState().accountId !== accountId) return;
        if (control.kind === "visibility") {
          await writeProfilePreference("agents.companion.visible", control.visible);
          show = control.visible;
          change({
            visible: show || state.phase !== "idle" || pointPending,
          });
        } else if (control.kind === "size") {
          await writeProfilePreference(
            "agents.companion.size",
            normalizeCompanionSize(control.size),
          );
          change({
            size: normalizeCompanionSize(control.size),
          });
        } else if (control.kind === "ask") {
          // End existing ownership before changing the next takeover's policy.
          if (await interruptNative()) {
            await writeProfilePreference("agents.companion.ask", control.ask);
            change({ ask: control.ask });
          }
        } else if (
          control.kind === "model" &&
          (control.model === "" || state.models?.some((m) => m.id === control.model))
        ) {
          if (await interruptNative()) {
            await writeProfilePreference("agents.companion.model", control.model);
            change({ model: control.model });
          }
        } else if (control.kind === "stop") {
          if (await interruptNative())
            change({
              visible: show,
            });
        } else if (control.kind === "retry") {
          if (speechRetry && nativeReady) {
            const id = speechRetry;
            change({ error: undefined, visible: true });
            await speak(id, turn);
            return;
          }
          if (!(await interruptNative())) return;
          turn = await nativeConfiguration(accountId);
          if (disposed) return;
          nativeReady = true;
          change({
            error: undefined,
            visible: show,
          });
        }
      };
      useCompanionState.setState({
        accountId,
        presentation: state,
        control,
        submit,
      });
      listen<CompanionControl>(controlEvent, (request) => {
        void control(request).catch((e) => fail(turn, e));
      });
      listen<{ turn: number; sequence: number; audio: string }>(
        "misty://cursor-audio",
        (payload) => {
          if (active(payload.turn)) voice?.append(payload.sequence, payload.audio);
        },
      );
      listen<{
        turn: number;
        durationMs: number;
      }>("misty://cursor-recorded", (payload) => {
        const generation = payload.turn;
        if (!active(generation) || recordedTurn === generation) return;
        recordedTurn = generation;
        if (payload.durationMs < 150) {
          stopAudio();
          change({
            phase: "idle",
          });
          maybeHide();
          return;
        }
        change({
          phase: "processing",
        });
        const controller = abort ?? new AbortController();
        abort = controller;
        void (async () => {
          await barrier;
          if (!active(generation)) return;
          if (!voice)
            throw new Error("The voice session did not start. Hold the shortcut to try again.");
          const textResult = await voice.commit();
          if (!active(generation)) return;
          const text = textResult.trim();
          if (!text) {
            stopAudio();
            change({
              phase: "idle",
            });
            maybeHide();
            return;
          }
          if (useMistyStore.getState().working)
            throw new Error(
              "An Agent conversation is already running. Stop it before starting a companion request.",
            );
          // Clicky captures only after transcript finalization; no stale pre-transcription frame.
          const screens = await capture(generation, controller.signal);
          if (!active(generation)) return;
          await submitCaptured(
            { prompt: text, conversationId: useMistyStore.getState().activeConversationId },
            generation,
            screens,
            controller.signal,
          );
        })().catch((e) => {
          if (!controller.signal.aborted) fail(generation, e);
        });
      });
      await Promise.all(removers);
      if (disposed) return;
      turn = Math.max(turn, await nativeConfiguration(accountId));
      if (disposed) {
        return;
      }
      nativeReady = true;
      change({});
      void assistantApi
        .frontierModels()
        .then((catalog) => {
          if (!disposed)
            change({
              models: catalog.models.map((m) => ({
                id: m.id,
                name: m.name,
              })),
            });
        })
        .catch(() => {});
    };
    void setup().catch((e) => fail(turn, e));
    return () => {
      disposed = true;
      stopPreferences();
      unsubscribe();
      stopAudio();
      clearTimeout(hideTimer);
      clearTimeout(pointTimer);
      for (const remove of removers) void remove.then((fn) => fn());
      if (owned && useMistyStore.getState().accountId === accountId)
        void useMistyStore.getState().cancelResponse?.();
      if (useCompanionState.getState().accountId === accountId)
        useCompanionState.setState({
          accountId: "",
          presentation: initialCompanionPresentation,
          control: undefined,
          submit: undefined,
        });
      void nativeConfiguration("");
    };
  }, [accountId]);
  return null;
}
