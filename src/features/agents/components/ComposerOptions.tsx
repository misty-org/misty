import type { ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { IconButton, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";

/**
 * The composer's settings in one place: the mode, the project, the model and how hard it thinks.
 * They open from a single sliders button, so the toolbar keeps only the small, frequent controls
 * (attach, usage, voice, send) outside.
 */
export function ComposerOptions(props: {
  mode: ReactNode;
  project: ReactNode;
  model: ReactNode;
  reasoning: ReactNode;
}) {
  const rows: [string, ReactNode][] = [
    ["Mode", props.mode],
    ["Project", props.project],
    ["Model", props.model],
    ["Thinking", props.reasoning],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Message options" tooltip={false}>
          <SlidersHorizontal className="size-4" aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="grid w-64 gap-1 p-2">
        {rows.map(([label, control]) => (
          <div key={label} className="flex items-center justify-between gap-3 px-1 py-0.5">
            <span className="text-xs text-cream-muted">{label}</span>
            <div className="flex min-w-0 items-center justify-end">{control}</div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
