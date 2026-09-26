import { Slider } from "@/shared/ui";
import {
  browserViewportRanges,
  browserViewportStep,
  type BrowserViewportAxis,
  type BrowserViewportDevice,
  type BrowserViewportSize,
} from "./browserViewport";

const axes: Array<{ axis: BrowserViewportAxis; label: string }> = [
  { axis: "width", label: "X" },
  { axis: "height", label: "Y" },
];

export function BrowserViewportSizeSliders(props: {
  device: BrowserViewportDevice;
  size: BrowserViewportSize;
  onChange: (size: BrowserViewportSize) => void;
}) {
  return (
    <div className="space-y-1 px-2 pb-2 pt-1">
      {axes.map(({ axis, label }) => {
        const range = browserViewportRanges[props.device][axis];
        return (
          <div key={axis} className="flex items-center gap-2.5 text-[11px] text-cream-muted">
            <span className="w-3 font-medium">{label}</span>
            <Slider
              min={range.min}
              max={range.max}
              step={browserViewportStep}
              value={[props.size[axis]]}
              onValueChange={([value]) => props.onChange({ ...props.size, [axis]: value })}
              aria-label={`Viewport ${axis}`}
              aria-valuetext={`${props.size[axis]} px`}
            />
            <span className="w-10 text-right tabular-nums">{props.size[axis]}</span>
          </div>
        );
      })}
    </div>
  );
}
