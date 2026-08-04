let referenceOnly = false;
const listeners = new Set<(value: boolean) => void>();

export function setSpaceReferenceOnly(value: boolean): void {
  if (referenceOnly === value) return;
  referenceOnly = value;
  listeners.forEach((listener) => listener(value));
}

export function isSpaceReferenceOnly(): boolean {
  return referenceOnly;
}

export function isSpaceWriteRequest(method?: string): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD" && normalized !== "OPTIONS";
}

export function subscribeSpaceReferenceOnly(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
