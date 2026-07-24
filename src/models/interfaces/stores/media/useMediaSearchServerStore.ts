import type { PreparedMediaChunk } from "@/models/interfaces/services/misty-api";
import { managedAiRequest } from "@/stores/assistant/useAiServerStore";

export interface MediaSearchHit {
  segmentId: string;
  assetId: string;
  mediaType: "audio" | "video";
  kind: "spoken" | "visual";
  content: string;
  transcript: string;
  visualDescription: string;
  startMs: number;
  endMs: number;
  visibleText: string[];
  score: number;
  semanticScore: number;
  lexicalScore: number;
}

export interface MediaSearchResponse {
  hits: MediaSearchHit[];
}

export interface MediaChunkIndexResponse {
  status: "indexed";
  chunkIndex: number;
  segmentCount?: number;
  indexedThroughMs?: number;
  hostedAIUsedRatio?: number;
  hostedAIResetAt?: string;
  alreadyIndexed?: boolean;
}
