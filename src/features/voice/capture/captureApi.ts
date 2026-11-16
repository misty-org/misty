import { apiRequest } from "@/api/client";
import { writeNotesOnEngine } from "./engineNotes";
import { invoke } from "@/native/invoke";
import { recognitionLanguage } from "../systemSpeech";

/** One speaker's continuous speech, in seconds from the start. */
export interface VoiceTurn {
  speaker: string;
  channel?: "mic" | "system";
  language?: string;
  start: number;
  end: number;
  text: string;
}

export type VoiceSourceKind = "mic" | "tab" | "system" | "app" | "library_item";

interface VoiceTranscript {
  id: string;
  title: string;
  source: { kind: VoiceSourceKind; url?: string; title?: string; library_item_id?: string };
  language: string;
  turns: VoiceTurn[];
  /** Names given to speakers in this transcript, by speaker label. */
  speakers: Record<string, string>;
  duration_ms: number;
  note_id: string;
}

export type VoiceNoteMode = "notes" | "summary" | "actions" | "chapters";

interface VoiceNoteResult {
  note_id: string;
  space_id?: string;
  title: string;
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

/**
 * A file's words, recognized by this computer, in the shape the server keeps a transcript in. The
 * system recognizer doesn't tell speakers apart, so it's one speaker throughout.
 */
async function recognizedTurns(mimeType: string | undefined, audio: string | undefined) {
  if (!audio) throw new Error("That file has no audio to transcribe.");
  const text = (
    await invoke<string>("speech_recognize_audio", {
      audio,
      mime: mimeType ?? "",
      language: recognitionLanguage(),
    })
  ).trim();
  return {
    text,
    language: "",
    durationInSeconds: null,
    turns: text ? [{ speaker: "1", start: 0, end: 0, text }] : [],
  };
}

export const captureApi = {
  save: (transcript: Omit<VoiceTranscript, "id" | "note_id">) =>
    apiRequest<{ id: string }>("/me/voice/transcripts", json("POST", transcript)),
  get: (id: string) =>
    apiRequest<VoiceTranscript>(`/me/voice/transcripts/${encodeURIComponent(id)}`),
  renameSpeakers: (id: string, speakers: Record<string, string>) =>
    apiRequest<void>(
      `/me/voice/transcripts/${encodeURIComponent(id)}`,
      json("PATCH", { speakers }),
    ),
  remove: (id: string) =>
    apiRequest<void>(`/me/voice/transcripts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** The server sends the transcript, the default engine writes the Note, and the server saves
   * it. */
  notes: async (
    id: string,
    body: { mode: VoiceNoteMode; user_notes?: string; note_id?: string; language?: string },
  ) => {
    const path = `/me/voice/transcripts/${encodeURIComponent(id)}/notes`;
    const first = await apiRequest<VoiceNoteResult & { on_device?: boolean; input?: unknown }>(
      path,
      json("POST", body),
    );
    if (!first.on_device) return first;
    const result = await writeNotesOnEngine(first.input, `${id}:${body.mode}`);
    return apiRequest<VoiceNoteResult>(path, json("POST", { ...body, result }));
  },
  /** The server hands over the file, this computer transcribes who said what, and the server
   * saves the transcript. */
  transcribe: async (body: { space_id: string; library_item_id: string; language?: string }) => {
    const first = await apiRequest<
      VoiceTranscript & { on_device?: boolean; mime_type?: string; audio_base64?: string }
    >("/me/voice/transcribe", json("POST", body));
    if (!first.on_device) return first;
    // Recognized by this computer, with no key; speakers aren't told apart.
    const result = await recognizedTurns(first.mime_type, first.audio_base64);
    return apiRequest<VoiceTranscript>("/me/voice/transcribe", json("POST", { ...body, result }));
  },
};
