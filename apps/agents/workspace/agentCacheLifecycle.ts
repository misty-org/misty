const resetters = new Set<() => void>();

export function registerAgentCacheReset(reset: () => void): () => void {
  resetters.add(reset);
  return () => resetters.delete(reset);
}

export function clearAllAgentCaches(): void {
  for (const reset of resetters) reset();
}
