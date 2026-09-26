import { browserToolbarStyles } from "./browserToolbarStyles";
import {
  cn,
  menuItemClass,
  menuLabelClass,
  menuListClass,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui";
import { Check, Laptop, MonitorSmartphone, Smartphone, Tablet } from "lucide-react";
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
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  { id: "responsive", label: "Responsive", icon: MonitorSmartphone },
  { id: "desktop", label: "Desktop", icon: Laptop },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "mobile", label: "Mobile", icon: Smartphone },
];

export function BrowserViewportMenuView(props: {
  value: BrowserViewport;
  onChange: (value: BrowserViewport) => void;
  sizes: Record<BrowserViewportDevice, BrowserViewportSize>;
  onSizeChange: (device: BrowserViewportDevice, size: BrowserViewportSize) => void;
  iconButtonClass: string;
  lightChrome: boolean;
  suspensionReason: string;
  setOverlay: (reason: string, active: boolean) => Promise<void>;
}) {
  const active = viewportOptions.find((option) => option.id === props.value) ?? viewportOptions[0];
  const ActiveIcon = active.icon;
  const overlay = useBrowserOverlay(props.suspensionReason, props.setOverlay);

  return (
    <Popover open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            props.iconButtonClass,
            props.value !== "responsive" &&
              (props.lightChrome
                ? "bg-black/[0.06] text-[#202020]"
                : "bg-white/[0.06] text-[#e9e9e9]"),
          )}
          aria-label={`Viewport: ${active.label}`}
          title={`Viewport: ${active.label}`}
        >
          <ActiveIcon {...browserToolbarStyles.icon} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn(
          "w-64 data-[state=closed]:animate-none data-[state=open]:animate-none",
          menuListClass,
        )}
      >
        <p className={menuLabelClass}>Viewport</p>
        {viewportOptions.map((option) => {
          const Icon = option.icon;
          const selected = option.id === props.value;
          const size = option.id === "responsive" ? null : props.sizes[option.id];
          return (
            <div key={option.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
                  "transition-colors hover:bg-charcoal-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-active/40",
                  selected && "bg-charcoal-hover text-cream",
                )}
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
              </button>
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
