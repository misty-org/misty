import { companionSizeDefault, normalizeCompanionSize } from "./companionSize";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { agentsApi } from "@/api/agents/api";
import { assistantApi } from "@/api/assistant/api";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  useCompanionState,
  initialCompanionPresentation,
  type CompanionControl,
} from "./companionState";
import { companionReply, resolvePoint } from "./companionReply";
import {
  controlEvent,
  spokenMode,
  type CompanionMode,
  type DisplayCapture,
  type Presentation,
} from "./protocol";

let nativeLifecycle = Promise.resolve<unknown>(undefined);
const nativeConfiguration = (accountId: string) => {
  const next = nativeLifecycle
    .catch(() => {})
    .then(() => invoke<number>("cursor_companion_configure", { accountId }));
  nativeLifecycle = next;
  return next;
};

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
    let abort: AbortController | undefined,
      audio: HTMLAudioElement | undefined,
      audioUrl: string | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let pointTimer: ReturnType<typeof setTimeout> | undefined;
    const preferenceKey = `misty.cursor-companion:${accountId}`;
    let show = true,
      model = "",
      size = companionSizeDefault;
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
      show = saved.visible !== false;
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
      mode: "team",
      model,
      size,
    };
    const active = (generation: number) =>
      !disposed && turn === generation && useMistyStore.getState().accountId === accountId;
    const publish = () => {
      if (disposed) return;
      useCompanionState.setState({ accountId, presentation: state });
      const published = state;
      if (nativeReady)
        void invoke("cursor_companion_present", { turn, presentation: published }).catch(
          (reason) => {
            if (!disposed && active(published.generation))
              useCompanionState.setState({ presentation: { ...state, error: String(reason) } });
          },
        );
    };
    const change = (patch: Partial<Presentation>) => {
      state = { ...state, ...patch, generation: turn, enabled: nativeReady, showCompanion: show };
      publish();
    };
    const persist = () => {
      try {
        localStorage.setItem(
          preferenceKey,
          JSON.stringify({ visible: show, model: state.model, size: state.size }),
        );
      } catch {
        /* optional preference */
      }
    };
    const maybeHide = () => {
      if (
        voicePending ||
        pointPending ||
        state.phase === "listening" ||
        state.phase === "processing"
      )
        return;
      const expected = turn;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (active(expected) && !show) change({ visible: false });
      }, 1000);
    };
    const stopAudio = () => {
      abort?.abort();
      abort = undefined;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio = undefined;
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = undefined;
      voicePending = false;
    };
    const interrupt = () => {
      stopAudio();
      clearTimeout(hideTimer);
      clearTimeout(pointTimer);
      pointPending = false;
      const shouldCancel = owned;
      owned = false;
      change({ point: undefined, phase: "idle", error: nativeReady ? undefined : state.error });
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
      void invoke<number>("cursor_companion_interrupt", { expectedTurn: generation })
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
        ? await invoke<number>("cursor_companion_interrupt", { expectedTurn: previous })
        : previous;
      if (!active(previous)) return false;
      turn = next;
      await interrupt();
      // The Agents composer shares this mode; stop its typed invocation as well.
      if (active(next) && useMistyStore.getState().working)
        await useMistyStore.getState().cancelResponse?.();
      return active(next);
    };
    const switchMode = async (mode: CompanionMode) => {
      if (state.mode !== mode && (await interruptNative())) change({ mode, visible: show });
    };
    const speak = async (invocationId: string, generation: number) => {
      voicePending = true;
      const controller = new AbortController();
      abort = controller;
      try {
        const blob = await agentsApi.speech(invocationId, controller.signal);
        if (!active(generation)) return;
        audioUrl = URL.createObjectURL(blob);
        audio = new Audio(audioUrl);
        audio.onended = () => {
          if (active(generation)) {
            stopAudio();
            change({ phase: "idle" });
            maybeHide();
          }
        };
        audio.onerror = () =>
          fail(
            generation,
            "The answer was saved, but speech could not play. Hold the shortcut to try again.",
          );
        await audio.play();
        if (active(generation)) change({ phase: "responding" });
      } catch (error) {
        if (!controller.signal.aborted) fail(generation, error);
      }
    };
    let captures: DisplayCapture[] = [];
    let submittedTurn = 0,
      invocationId: string | undefined;
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
        .find((c) => c.id === current.activeConversationId)
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
      change({ phase: "idle", point });
      if (point) {
        const expected = turn;
        // Handles display removal or an overlay reload before its animation completion event.
        pointTimer = setTimeout(() => {
          if (active(expected)) {
            pointPending = false;
            change({ point: undefined });
            maybeHide();
          }
        }, 15_000);
      }
      void speak(invocationId, submittedTurn);
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
      useMistyStore.getState().setAccount(accountId);
      listen<{ turn: number; held: boolean }>("misty://cursor-shortcut", (payload) => {
        if (payload.turn < turn) return;
        if (payload.held) {
          turn = payload.turn;
          captures = [];
          invocationId = undefined;
          void interrupt().catch((e) => fail(turn, e));
          change({ visible: true, phase: "listening" });
        } else if (payload.turn === turn) change({ phase: "processing" });
      });
      listen<{ turn: number; captures: DisplayCapture[] }>("misty://cursor-captures", (payload) => {
        if (active(payload.turn)) captures = payload.captures;
      });
      listen<{ error: string }>("misty://cursor-renderer-error", (payload) =>
        fail(turn, payload.error),
      );
      listen<{ turn: number; error: string }>("misty://cursor-error", (payload) =>
        fail(payload.turn, payload.error),
      );
      listen<{ generation: number }>("misty://cursor-point-finished", (payload) => {
        if (payload.generation === turn) {
          pointPending = false;
          clearTimeout(pointTimer);
          change({ point: undefined });
          maybeHide();
        }
      });
      listen("misty://cursor-displays-changed", () => {
        if (pointPending) {
          pointPending = false;
          change({ point: undefined });
          maybeHide();
        }
      });
      const control = async (control: CompanionControl) => {
        if (disposed || useMistyStore.getState().accountId !== accountId) return;
        if (control.kind === "visibility") {
          show = control.visible;
          persist();
          change({ visible: show || state.phase !== "idle" || pointPending });
        } else if (control.kind === "size") {
          change({ size: normalizeCompanionSize(control.size) });
          persist();
        } else if (control.kind === "mode") {
          await switchMode(control.mode);
        } else if (
          control.kind === "model" &&
          (control.model === "" || state.models?.some((m) => m.id === control.model))
        ) {
          if (await interruptNative()) {
            change({ model: control.model });
            persist();
          }
        } else if (control.kind === "stop") {
          if (await interruptNative()) change({ visible: show });
        } else if (control.kind === "retry") {
          if (!(await interruptNative())) return;
          turn = await nativeConfiguration(accountId);
          if (disposed) return;
          nativeReady = true;
          change({ error: undefined, visible: show });
        }
      };
      useCompanionState.setState({ accountId, presentation: state, control });
      listen<CompanionControl>(controlEvent, (request) => {
        void control(request).catch((e) => fail(turn, e));
      });
      listen<{ turn: number; audio: string; durationMs: number }>(
        "misty://cursor-recorded",
        (payload) => {
          const generation = payload.turn;
          if (!active(generation)) return;
          if (payload.durationMs < 150) {
            change({ phase: "idle" });
            maybeHide();
            return;
          }
          change({ phase: "processing" });
          const controller = new AbortController();
          abort = controller;
          void (async () => {
            await barrier;
            if (!active(generation)) return;
            const bytes = Uint8Array.from(atob(payload.audio), (c) => c.charCodeAt(0));
            const [transcription, screens] = await Promise.all([
              agentsApi.transcribeVoice(
                new Blob([bytes], { type: "audio/wav" }),
                payload.durationMs,
                controller.signal,
              ),
              invoke<DisplayCapture[]>("cursor_companion_capture", { turn: generation }),
            ]);
            if (!active(generation)) return;
            const text = transcription.transcript.trim();
            if (!text) {
              change({ phase: "idle" });
              maybeHide();
              return;
            }
            const mode = spokenMode(text);
            if (mode) {
              await switchMode(mode);
              change({ phase: "idle" });
              maybeHide();
              return;
            }
            if (useMistyStore.getState().working)
              throw new Error(
                "An Agent conversation is already running. Stop it before starting a companion request.",
              );
            captures = screens;
            submittedTurn = generation;
            owned = true;
            const current = useMistyStore.getState();
            await current.submitAnswer(
              text,
              [],
              undefined,
              "workspace",
              [],
              { conversationId: current.activeConversationId, context: [] },
              {
                turn: generation,
                executionMode: "agent",
                interactionMode: state.mode,
                displayCaptures: screens,
                model: state.model,
              },
            );
            if (!active(generation)) return;
            invocationId = useMistyStore.getState().invocationId;
            if (!invocationId) {
              owned = false;
              throw new Error(
                useMistyStore.getState().error ||
                  "The companion could not start. Hold the shortcut to retry.",
              );
            }
            settle();
          })().catch((e) => {
            if (!controller.signal.aborted) fail(generation, e);
          });
        },
      );
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
              models: catalog.models
                .filter((m) => m.id.startsWith("openai/"))
                .map((m) => ({ id: m.id, name: m.name })),
            });
        })
        .catch(() => {});
    };
    void setup().catch((e) => fail(turn, e));
    return () => {
      disposed = true;
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
        });
      void nativeConfiguration("");
    };
  }, [accountId]);
  return null;
}
