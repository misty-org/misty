import type { SpaceLibraryItem } from "./entities";

export type ChatComposerSuggestion =
  | { kind: "member"; id: string; label: string; detail: string }
  | { kind: "agent"; id: string; label: string; detail: string }
  | { kind: "library"; id: string; label: string; detail: string; item: SpaceLibraryItem };
