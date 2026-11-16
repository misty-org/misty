import { createPort } from "@/shared/lib/seams";

/**
 * The default engine, for voice's own writing (notes from a capture, tidying dictation): Misty
 * has no model of its own. Agents sits above voice, so the app fills this in at startup with the
 * agents' chat-less engine run.
 */
export interface VoiceEngine {
  run(input: { prompt: string; key: string }): Promise<{ text: string; error?: string }>;
}

export const voiceEngine = createPort<VoiceEngine>("Default engine for voice");
