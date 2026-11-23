export type ChatComposerSuggestion =
  | { kind: "member"; id: string; label: string; detail: string }
  | { kind: "agent"; id: string; label: string; detail: string }
  | { kind: "role"; id: string; label: string; detail: string; color: string };
