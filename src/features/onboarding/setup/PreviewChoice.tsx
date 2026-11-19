import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Pressable, Surface, Text } from "@/shared/ui";

/** A preview tile; the selected one gets a stronger border and a checkmark. */
export function PreviewChoice(props: {
  label: string;
  selected: boolean;
  onSelect(): void;
  children: ReactNode;
}) {
  return (
    <Pressable
      role="radio"
      aria-checked={props.selected}
      onClick={props.onSelect}
      wash="card"
      className="flex flex-col rounded-lg text-left transition-colors"
    >
      <Surface
        tone={props.selected ? "well" : "none"}
        edge={props.selected ? "strong" : "hairline"}
        radius="lg"
        className="flex flex-col gap-2 p-2"
      >
        {props.children}
        <Text bare tone="bright" className="flex items-center gap-1.5 px-0.5">
          <span className="min-w-0 flex-1 text-sm">{props.label}</span>
          {props.selected ? <Check aria-hidden="true" className="shrink-0" /> : null}
        </Text>
      </Surface>
    </Pressable>
  );
}
