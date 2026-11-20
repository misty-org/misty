import type { ReactNode } from "react";
import { Separator, Slider, Text } from "@misty/ui";

/**
 * One of the editor's side panels, as OpenCut's panel views: a 44px header with the panel's name
 * and its actions, a hairline, then the panel's content scrolling under it.
 */
export function PhotoPanelView(props: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={props.title} className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 pr-2 pl-3">
        <Text size="control" tone="muted" full className="min-w-0">
          {props.title}
        </Text>
        {props.actions ? (
          <div className="flex shrink-0 items-center gap-1">{props.actions}</div>
        ) : null}
      </div>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 px-3 pt-3 pb-4">{props.children}</div>
      </div>
    </section>
  );
}

/** A named group of controls in a panel: Light, Color and Detail under Adjust. */
export function PanelSection(props: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={props.title} className="flex flex-col gap-3">
      <Text size="meta" tone="bright" weight="medium">
        {props.title}
      </Text>
      {props.children}
    </div>
  );
}

/** How a slider's value reads: signed for an adjustment, degrees for straightening. */
function shown(value: number, unit: "" | "°" | "%", signed: boolean) {
  const rounded = Math.round(value);
  const text =
    signed && rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${-rounded}` : String(rounded);
  return `${text}${unit}`;
}

/**
 * One slider with its name and value. The image changes under it as it moves (`onPreview`) and the
 * change is kept when it lets go (`onCommit`); a double click on the name sets it back.
 */
export function PanelSlider(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  /** The value a double click on the name returns it to. */
  rest?: number;
  unit?: "" | "°" | "%";
  disabled?: boolean;
  onPreview: (value: number) => void;
  onCommit: () => void;
}) {
  const { min = -100, max = 100, rest = 0, unit = "" } = props;
  return (
    <div className="grid gap-1">
      <div
        className="flex items-center justify-between gap-2"
        onDoubleClick={() => {
          if (props.disabled) return;
          props.onPreview(rest);
          props.onCommit();
        }}
      >
        <Text size="control" tone="default">
          {props.label}
        </Text>
        <Text size="meta" tone={props.value === rest ? "muted" : "bright"} className="tabular-nums">
          {shown(props.value, unit, min < 0)}
        </Text>
      </div>
      <Slider
        aria-label={props.label}
        value={[props.value]}
        min={min}
        max={max}
        step={1}
        disabled={props.disabled}
        onValueChange={([next]) => props.onPreview(next ?? props.value)}
        onValueCommit={props.onCommit}
      />
    </div>
  );
}
