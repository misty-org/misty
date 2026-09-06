export function mistyIntent(query: string): "answer" | "agent" | "search" {
  const agentVerb =
    "create|write|draft|draw|sketch|illustrate|organize|plan|research|build|make|" +
    "send|schedule|delegate|handle|update|change|fix|prepare|collect|turn";
  const agentRequest = new RegExp(
    `^(?:(?:please|can you|could you|would you|will you|i need you to)\\s+)?(?:${agentVerb})\\b`,
  );
  if (agentRequest.test(query)) {
    return "agent";
  }
  if (
    /^(why|what|when|where|who|which|how|can you explain|tell me|compare|summari[sz]e|explain)\b/.test(
      query,
    ) ||
    query.endsWith("?")
  ) {
    return "answer";
  }
  return "search";
}
