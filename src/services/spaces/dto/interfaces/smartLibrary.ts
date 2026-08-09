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
