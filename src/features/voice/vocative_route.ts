import { createPort } from "@/shared/lib/seams";
import type { Vocative } from "./vocative";

export const vocativeRouting = createPort<{
  findVocative(transcript: string): Vocative | null;
  routeToAgent(vocative: Vocative): Promise<void>;
}>("routing dictation to agents");

export const findVocative = (transcript: string): Vocative | null =>
  vocativeRouting.get().findVocative(transcript);

export const routeToAgent = (vocative: Vocative): Promise<void> =>
  vocativeRouting.get().routeToAgent(vocative);
