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
  fallback: "google/gemini-3.1-flash-lite",
  evaluatedAlternatives: ["openai/gpt-4.1-nano", "openai/gpt-5.4-nano"],
  semanticEmbedding: "openai/text-embedding-3-small",
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
        required: ["assetId", "description", "tags", "suggestedCollections", "confidence"],
        properties: {
          assetId: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 12, maxLength: 320 },
          tags: { type: "array", minItems: 3, maxItems: 16, items: { type: "string", minLength: 1, maxLength: 48 } },
          suggestedCollections: { type: "array", maxItems: 5, items: { type: "string", minLength: 1, maxLength: 64 } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;
