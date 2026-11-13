import { useSettingsStore } from "@/features/settings";
import { voiceSettings } from "../voiceSettings";
import { captureApi } from "./captureApi";
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

/** Transcribes an audio or video file from a Library and shows the result. */
export async function transcribeLibraryFile(spaceId: string, itemId: string, title: string) {
  const store = useCaptureStore.getState();
  store.show({ id: "", title, turns: [], speakers: {} });
  useCaptureStore.setState({ phase: "working" });
  try {
    const language = settings().language;
    const transcript = await captureApi.transcribe({
      space_id: spaceId,
      library_item_id: itemId,
      language: language === "auto" ? undefined : language,
    });
    store.show(transcript);
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
