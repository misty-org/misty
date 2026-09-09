export const SMART_LIBRARY_PILOT = {
  sampleSize: 25,
  maximumSuccessfulImages: 500,
  previewBatchSize: 8,
  previewMinimumDimension: 384,
  previewMaximumDimension: 512,
  billingMeter: "asset_analysis_image",
} as const;

export const SMART_LIBRARY_MODEL_POLICY = {
  primary: "google/gemini-2.5-flash-lite",
  fallback: "google/gemini-3-flash",
  evaluatedAlternatives: ["openai/gpt-4.1-nano", "openai/gpt-5.4-nano"],
  semanticEmbedding: "google/gemini-embedding-2",
  premiumOnly: ["openai/gpt-5.6-luna", "openai/gpt-5.6-terra"],
  thinking: "minimal",
  maximumFallbackAttempts: 1,
  fallbackConditions: [
    "schema_invalid",
    "description_empty_or_generic",
    "required_categories_missing",
    "confidence_below_evaluated_threshold",
  ],
} as const;

/**
 * Planning estimate for a 512 px path-free preview plus structured metadata and
 * one semantic embedding. Provider usage remains authoritative; model retries
 * are intentionally excluded because Misty absorbs infrastructure retries.
 */
export function estimateSmartLibraryTokens(assetCount: number): SmartLibraryTokenEstimate {
  const count = Math.max(0, Math.floor(assetCount));
  const batchCount = Math.ceil(count / SMART_LIBRARY_PILOT.previewBatchSize);
  const estimatedInputTokens = count * 340 + batchCount * 180;
  const estimatedOutputTokens = count * 220;
  const estimatedEmbeddingTokens = count * 266;
  const estimatedTotalTokens =
    estimatedInputTokens + estimatedOutputTokens + estimatedEmbeddingTokens;
  return {
    assetCount: count,
    batchCount,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedEmbeddingTokens,
    estimatedTotalTokens,
    estimatedLowTokens: count * 650,
    estimatedHighTokens: count * 1_100,
  };
}

/** Shared strict-output contract for the managed vision worker. */
export const SMART_LIBRARY_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assets"],
  properties: {
    assets: {
      type: "array",
      maxItems: SMART_LIBRARY_PILOT.previewBatchSize,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "assetId",
          "assetKind",
          "mimeType",
          "description",
          "tags",
          "suggestedCollections",
          "confidence",
          "metadata",
        ],
        properties: {
          assetId: { type: "string", minLength: 1 },
          assetKind: { type: "string", minLength: 1, maxLength: 32 },
          mimeType: { type: "string", minLength: 1, maxLength: 96 },
          description: { type: "string", minLength: 12, maxLength: 500 },
          tags: {
            type: "array",
            minItems: 3,
            maxItems: 24,
            items: { type: "string", minLength: 1, maxLength: 64 },
          },
          suggestedCollections: {
            type: "array",
            maxItems: 5,
            items: { type: "string", minLength: 1, maxLength: 64 },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          metadata: {
            type: "object",
            additionalProperties: false,
            required: [
              "contentType",
              "primarySubject",
              "searchTerms",
              "entities",
              "characters",
              "brands",
              "applications",
              "objects",
              "scenes",
              "activities",
              "colors",
              "visibleText",
              "topics",
            ],
            properties: {
              contentType: { type: "string", minLength: 1, maxLength: 64 },
              primarySubject: { type: "string", minLength: 1, maxLength: 160 },
              searchTerms: {
                type: "array",
                minItems: 3,
                maxItems: 32,
                items: { type: "string", minLength: 1, maxLength: 80 },
              },
              entities: stringArraySchema(24),
              characters: stringArraySchema(12),
              brands: stringArraySchema(12),
              applications: stringArraySchema(12),
              objects: stringArraySchema(24),
              scenes: stringArraySchema(12),
              activities: stringArraySchema(12),
              colors: stringArraySchema(12),
              visibleText: stringArraySchema(24, 160),
              topics: stringArraySchema(16),
            },
          },
        },
      },
    },
  },
} as const;

function stringArraySchema(maxItems: number, maxLength = 64) {
  return { type: "array", maxItems, items: { type: "string", minLength: 1, maxLength } } as const;
}

export interface SmartLibraryTokenEstimate {
  assetCount: number;
  batchCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedEmbeddingTokens: number;
  estimatedTotalTokens: number;
  estimatedLowTokens: number;
  estimatedHighTokens: number;
}
