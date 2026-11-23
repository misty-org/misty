import type { ReactNode } from "react";
import { ChoiceTile } from "@misty/ui";

export function PreviewChoice(props: {
  label: string;
  selected: boolean;
  onSelect(): void;
  children: ReactNode;
}) {
  return (
    <ChoiceTile
      radio
      look="outline"
      label={props.label}
      caption={props.label}
      selected={props.selected}
      onSelect={props.onSelect}
      className="justify-items-stretch"
    >
      {props.children}
    </ChoiceTile>
  );
}
