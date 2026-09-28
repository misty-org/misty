/** Narrow fast path for explanations. Ambiguous requests keep the permission-aware executor. */
export function isCompanionExplanation(prompt: string): boolean {
  const text = prompt.trim().replace(/^(?:misty[, ]+)?(?:please\s+)?/i, "");
  if (
    /\b(?:and(?: then)?|then|also)\s+(?:click|open|navigate|type|submit|delete|download|upload|search|save)\b/i.test(
      text,
    )
  )
    return false;
  return /^(?:(?:can|could|would|will) you\s+)?(?:explain|describe|summari[sz]e|(?:show|tell) me (?:the )?(?:solution|answer|meaning)|(?:what|why|where|how)\b)/i.test(
    text,
  );
}

export function requestsScreenContext(prompt: string): boolean {
  return /\b(?:on my screen|this (?:problem|puzzle|page|screen|window|error)|what (?:is|am I looking at) this|what(?:'s| is) this)\b/i.test(
    prompt,
  );
}
