import { useSettingsStore } from "@/features/settings";
import { voiceSettings } from "../voiceSettings";
import { recognizeAudio } from "../speech";
import { useCaptureStore } from "./useCaptureStore";

function settings() {
  return voiceSettings(useSettingsStore.getState().settings?.document);
}

/** Whether Settings › Voice includes the microphone with other audio. */
function withMic() {
  return settings().captureSources.startsWith("mic");
}

export function captureMicrophone(title = "Voice note") {
  return useCaptureStore.getState().start({ kind: "mic", title, mic: true }, settings().language);
}

export function captureSystemAudio(title = "System audio") {
  return useCaptureStore
    .getState()
    .start({ kind: "system", title, mic: withMic() }, settings().language);
}

/**
 * Transcribes an audio or video file (such as one of a Space's drive files, read on this computer)
 * with the computer's own speech recognition, and shows the words. Nothing of it goes to the server,
 * so the transcript isn't saved; the recognizer doesn't tell speakers apart.
 */
export async function transcribeAudioFile(file: File, title = file.name) {
  const store = useCaptureStore.getState();
  store.show({ id: "", title, turns: [], speakers: {} });
  useCaptureStore.setState({ phase: "working" });
  try {
    const text = (await recognizeAudio(file)).trim();
    store.show({
      id: "",
      title,
      turns: text ? [{ speaker: "1", start: 0, end: 0, text }] : [],
      speakers: {},
    });
  } catch (error) {
    useCaptureStore.setState({
      phase: "idle",
      notice:
        error instanceof Error && error.message
          ? error.message
          : "That file couldn't be transcribed.",
    });
  }
}
