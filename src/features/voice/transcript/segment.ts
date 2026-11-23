export type Language = string;

export type Channel = "mic" | "system";

export type Word = {
  text: string;
  t0: number;
  t1: number;
  speaker?: string;
};

export type SegmentState = "provisional" | "pending" | "complete" | "translation-error";

export type Segment<L extends string = Language> = {
  id: string;
  sessionId: string;
  sequence: number;
  revision: number;
  startMs: number;
  endMs: number;
  sourceLanguage: L;
  targetLanguage: L;
  sourceText: string;
  translatedText: string;
  final: boolean;
  state: SegmentState;
  speaker?: string;
  channel?: Channel;
  words?: Word[];
  historyGeneration?: number;
  sessionStartedAt?: string;
};

export function speakerKey(segment: { channel?: Channel; speaker?: string }) {
  if (segment.channel === "mic") return segment.speaker ? `you:${segment.speaker}` : "you";
  return `${segment.channel ?? "audio"}:${segment.speaker ?? "?"}`;
}
