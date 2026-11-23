import { createPort } from "@/shared/lib/seams";

export interface VoiceEngine {
  run(input: { prompt: string; key: string }): Promise<{ text: string; error?: string }>;
}

export const voiceEngine = createPort<VoiceEngine>("Default engine for voice");
