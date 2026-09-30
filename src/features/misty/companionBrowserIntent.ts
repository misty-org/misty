export function companionRequestsBrowser(prompt: string): boolean {
  return new RegExp(
    "^(?:(?:please|misty)[, ]+)*(?:(?:can|could|would|will) you (?:please )?)?" +
      "(?:open|navigate|go to|search|find|book|buy|download|upload|fill|click|do this|do that|take over)\\b",
    "i",
  ).test(prompt);
}
