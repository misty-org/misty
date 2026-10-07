import { writeProfilePreference } from "@/features/settings/sync";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { invoke } from "@tauri-apps/api/core";
import { normalizeCompanionSize } from "./companionSize";
import type { CompanionControl } from "./companionState";
import type { CursorCompanionSession } from "./cursorCompanionSession";
import type { CursorCompanionVoice } from "./cursorCompanionVoice";
import { nativeConfiguration } from "./nativeConfiguration";

/** Applies a control from the companion overlay or the Agents settings panel. */
export function createCompanionControl(s: CursorCompanionSession, voice: CursorCompanionVoice) {
  return async (control: CompanionControl) => {
    if (s.disposed || useMistyStore.getState().accountId !== s.accountId) return;
    if (control.kind === "visibility") {
      await writeProfilePreference("agents.companion.visible", control.visible);
      s.show = control.visible;
      s.change({
        visible: s.show || s.state.phase !== "idle" || s.pointPending,
      });
    } else if (control.kind === "size") {
      await writeProfilePreference("agents.companion.size", normalizeCompanionSize(control.size));
      s.change({
        size: normalizeCompanionSize(control.size),
      });
    } else if (control.kind === "ask") {
      // End existing ownership before changing the next takeover's policy.
      if (await s.interruptNative()) {
        await writeProfilePreference("agents.companion.ask", control.ask);
        s.change({ ask: control.ask });
      }
    } else if (
      control.kind === "model" &&
      (control.model === "" || s.state.models?.some((m) => m.id === control.model))
    ) {
      if (await s.interruptNative()) {
        await writeProfilePreference("agents.companion.model", control.model);
        s.change({ model: control.model });
      }
    } else if (control.kind === "stop_audio") {
      const previous = s.turn;
      const next = s.nativeReady
        ? await invoke<number>("cursor_companion_interrupt", { expectedTurn: previous })
        : previous;
      if (!s.active(previous)) return;
      s.turn = next;
      await s.interrupt(false);
      s.change({ visible: s.show });
    } else if (control.kind === "stop") {
      if (await s.interruptNative())
        s.change({
          visible: s.show,
        });
    } else if (control.kind === "retry") {
      if (s.speechRetry && s.nativeReady) {
        const id = s.speechRetry;
        s.change({ error: undefined, visible: true });
        await voice.speak(id, s.turn);
        return;
      }
      if (!(await s.interruptNative(false))) return;
      s.turn = await nativeConfiguration(s.accountId);
      if (s.disposed) return;
      s.nativeReady = true;
      s.change({
        error: undefined,
        visible: s.show,
      });
    }
  };
}
