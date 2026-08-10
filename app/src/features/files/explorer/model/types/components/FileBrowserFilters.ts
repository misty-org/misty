export type EntryFilterMatcher =
  { kind: "substring"; query: string } | { kind: "pattern"; expression: RegExp };
