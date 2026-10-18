import { apiRequest } from "@/api/client";

/** One speaker's continuous speech, in seconds from the start. */
export interface VoiceTurn {
  speaker: string;
  channel?: "mic" | "system";
  language?: string;
  start: number;
  end: number;
  text: string;
}

export type VoiceSourceKind = "mic" | "tab" | "system" | "app" | "recording" | "library_item";

export interface VoiceTranscript {
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

export interface VoiceNoteResult {
  note_id: string;
  space_id?: string;
  title: string;
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

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
  /** Links the Library item that holds the recording. */
  recordingItem: (id: string, itemId: string) =>
    apiRequest<void>(
      `/me/voice/transcripts/${encodeURIComponent(id)}`,
      json("PATCH", { recording_item_id: itemId }),
    ),
  remove: (id: string) =>
    apiRequest<void>(`/me/voice/transcripts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  notes: (
    id: string,
    body: { mode: VoiceNoteMode; user_notes?: string; note_id?: string; language?: string },
  ) =>
    apiRequest<VoiceNoteResult>(
      `/me/voice/transcripts/${encodeURIComponent(id)}/notes`,
      json("POST", body),
    ),
  transcribe: (body: { space_id: string; library_item_id: string; language?: string }) =>
    apiRequest<VoiceTranscript>("/me/voice/transcribe", json("POST", body)),
};
