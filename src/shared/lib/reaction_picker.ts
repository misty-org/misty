import type { ComponentType, ReactElement } from "react";

export type ReactionPicker = ComponentType<{
  children?: ReactElement;
  onSelect(emoji: string): void;
}>;

let provided: ReactionPicker | null = null;

export function provideReactionPicker(picker: ReactionPicker) {
  provided = picker;
}

export const reactionPicker = () => provided;
