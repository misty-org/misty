import { useEffect } from "react";
import { setTranscriber } from "@opencut/services/transcription/service";
import { groupWordsIntoTimedPhrases } from "@opencut/transcription/group-words";
import type { VideoEditorProps } from "./videoEditorTypes";

/**
 * Lets the editor's captions tab transcribe through the computer's own speech recognition
 * while the editor is open. Without one, the tab offers no captions to make. Each phrase keeps
 * its words' times, so karaoke captions can light them up as they're said.
 */
export function useTranscriber(transcribe: VideoEditorProps["transcribe"]) {
  useEffect(() => {
    if (!transcribe) return;
    setTranscriber(async ({ audio, language }) => {
      const words = await transcribe(audio, language);
      return {
        text: words.map((word) => word.text).join(" "),
        segments: groupWordsIntoTimedPhrases(
          words.map(({ text, start, end }) => ({ text, start, end })),
        ),
        language: language ?? "",
      };
    });
    return () => setTranscriber(null);
  }, [transcribe]);
}
