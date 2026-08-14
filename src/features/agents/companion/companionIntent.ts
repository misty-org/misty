export function requestsScreenContext(prompt: string): boolean {
  return /\b(?:on my screen|this (?:problem|puzzle|page|screen|window|error)|what (?:is|am I looking at) this|what(?:'s| is) this)\b/i.test(
    prompt,
  );
}
