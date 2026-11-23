import { writeDevicePreference } from "@/features/settings/preference_access";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { lessonConversation } from "../lessons/lesson_entry";
import { normalizeCompanionSize } from "./companion_size";
import type { CompanionControl } from "./companion_state";
import type { CursorCompanionSession } from "./cursor_companion_session";
import type { CursorCompanionVoice } from "./cursor_companion_voice";
import { nativeConfiguration } from "./native_configuration";

export function createCompanionControl(s: CursorCompanionSession, voice: CursorCompanionVoice) {
  return async (control: CompanionControl) => {
    if (s.disposed || useMistyStore.getState().accountId !== s.accountId) return;
    if (control.kind === "size") {
      await writeDevicePreference("agents.companion.size", normalizeCompanionSize(control.size));
      s.change({
        size: normalizeCompanionSize(control.size),
      });
    } else if (control.kind === "ask") {
      if (await s.interruptNative()) {
        await writeDevicePreference("agents.companion.ask", control.ask);
        s.change({ ask: control.ask });
      }
    } else if (control.kind === "teach") {
      await writeDevicePreference("agents.companion.teach", control.teach);
      s.change({ teach: control.teach });
      if (control.teach) await lessonConversation();
    } else if (control.kind === "captions") {
      await writeDevicePreference("agents.companion.captions", control.captions);
      s.change({ captions: control.captions });
      if (!control.captions) s.setSpoken(undefined);
    } else if (control.kind === "sprite") {
      await writeDevicePreference("agents.companion.sprite", control.sprite);
      s.change({ sprite: control.sprite });
    } else if (control.kind === "tint") {
      await writeDevicePreference("agents.companion.tint", control.tint);
      s.change({ tint: control.tint });
    } else if (control.kind === "tour") {
      if (control.start) s.tour.start();
      else s.tour.stop();
    } else if (control.kind === "stop_audio") {
      const previous = s.turn;
      const next = s.nativeReady ? await s.endNativeTurn(previous) : previous;
      if (!s.active(previous)) return;
      s.turn = next;
      await s.interrupt(false);
      s.change({ visible: false });
    } else if (control.kind === "stop") {
      if (await s.interruptNative())
        s.change({
          visible: false,
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
        visible: false,
      });
    }
  };
}
