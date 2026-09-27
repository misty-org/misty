import {
  Button,
  cn,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toolbarIconProps,
} from "@/shared/ui";
import { Check, Laptop, RectangleHorizontal } from "lucide-react";
import type { ComponentType } from "react";
import type {
  BrowserViewport,
  BrowserViewportDevice,
  BrowserViewportSize,
} from "./browserViewport";
import { BrowserViewportSizeSliders } from "./BrowserViewportSizeSliders";
import { useBrowserOverlay } from "./useBrowserOverlay";
export * from "./browserViewport";
const viewportOptions: Array<{
  id: BrowserViewport;
  label: string;
  icon: ComponentType<{
    size?: number;
    strokeWidth?: number;
  }>;
}> = [
  {
    id: "responsive",
    label: "Responsive",
    icon: RectangleHorizontal,
  },
  {
    id: "desktop",
    label: "Desktop",
    icon: Laptop,
  },
];
export function BrowserViewportMenuView(props: {
  value: BrowserViewport;
  onChange: (value: BrowserViewport) => void;
  sizes: Record<BrowserViewportDevice, BrowserViewportSize>;
  onSizeChange: (device: BrowserViewportDevice, size: BrowserViewportSize) => void;
  suspensionReason: string;
  setOverlay: (reason: string, active: boolean) => Promise<void>;
}) {
  const active = viewportOptions.find((option) => option.id === props.value) ?? viewportOptions[0];
  const ActiveIcon = active.icon;
  const overlay = useBrowserOverlay(props.suspensionReason, props.setOverlay);
  return (
    <Popover open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          label={`Viewport: ${active.label}`}
          tooltip={false}
          className={cn(props.value !== "responsive" && "bg-cream/[0.06] text-cream")}
        >
          <ActiveIcon {...toolbarIconProps} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="grid w-64 gap-1 p-1">
        <p className="m-0 px-2 py-1 text-xs font-medium text-cream-muted">Viewport</p>
        {viewportOptions.map((option) => {
          const Icon = option.icon;
          const selected = option.id === props.value;
          const size = option.id === "responsive" ? null : props.sizes[option.id];
          return (
            <div key={option.id}>
              <Button
                variant="ghost"
                size="none"
                justify="start"
                className="h-auto w-full gap-2.5 px-2 py-2 text-left font-normal"
                aria-pressed={selected}
                onClick={() => props.onChange(option.id)}
              >
                <Icon strokeWidth={1.8} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{option.label}</span>
                  <span className="block text-[11px] text-cream-muted">
                    {size ? `${size.width} × ${size.height}` : "Fit this pane"}
                  </span>
                </span>
                {selected ? <Check size={14} aria-hidden /> : null}
              </Button>
              {selected && size ? (
                <BrowserViewportSizeSliders
                  device={option.id as BrowserViewportDevice}
                  size={size}
                  onChange={(next) => props.onSizeChange(option.id as BrowserViewportDevice, next)}
                />
              ) : null}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
