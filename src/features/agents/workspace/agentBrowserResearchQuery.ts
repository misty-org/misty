export function agentBrowserResearchQuery(prompt: string): string {
  const normalized = prompt.trim();
  if (
    !/\b(?:browse|search|research|look\s+up|find\s+(?:online|on\s+the\s+web)|web\s+search)\b/i.test(
      normalized,
    )
  ) {
    return "";
  }
  const withoutLead = normalized.replace(
    /^(?:please\s+)?(?:browse|search|research|look\s+up|find)(?:\s+the\s+web|\s+online|\s+on\s+the\s+web)?(?:\s+for)?\s*/i,
    "",
  );
  const focused = withoutLead.split(
    /\s+(?:(?:and\s+)?then|and)\s+(?:save|post|send|share|summarize)\b/i,
  )[0];
  return (focused || normalized).trim().slice(0, 500);
}
