import { apiRequest } from "@/api/client";
import { writeNotesOnEngine } from "./engineNotes";

/** One speaker's continuous speech, in seconds from the start. */
export interface VoiceTurn {
  speaker: string;
  channel?: "mic" | "system";
  language?: string;
  start: number;
  end: number;
  text: string;
}

export type VoiceSourceKind = "mic" | "tab" | "system" | "app";

interface VoiceTranscript {
  id: string;
  title: string;
  source: { kind: VoiceSourceKind; url?: string; title?: string };
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
};
