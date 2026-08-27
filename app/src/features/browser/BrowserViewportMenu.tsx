import { cn, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { Check, Laptop, MonitorSmartphone, Smartphone, Tablet } from "lucide-react";
import type { ComponentType } from "react";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";

export type BrowserViewport = "responsive" | "desktop" | "tablet" | "mobile";

export const browserViewportWidths: Record<BrowserViewport, number | null> = {
  responsive: null,
  desktop: 1280,
  tablet: 820,
  mobile: 390,
};

const viewportOptions: Array<{
  id: BrowserViewport;
  label: string;
  detail: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  { id: "responsive", label: "Responsive", detail: "Fit this pane", icon: MonitorSmartphone },
  { id: "desktop", label: "Desktop", detail: "1280 px", icon: Laptop },
  { id: "tablet", label: "Tablet", detail: "820 px", icon: Tablet },
  { id: "mobile", label: "Mobile", detail: "390 px", icon: Smartphone },
];

export function BrowserViewportMenu(props: {
  value: BrowserViewport;
  onChange: (value: BrowserViewport) => void;
  iconButtonClass: string;
  lightChrome: boolean;
  suspensionReason: string;
}) {
  const active = viewportOptions.find((option) => option.id === props.value) ?? viewportOptions[0];
  const ActiveIcon = active.icon;
  const overlay = useBrowserOverlayControl(props.suspensionReason);

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
          <ActiveIcon size={20} strokeWidth={1.7} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-56 p-1.5 data-[state=closed]:animate-none data-[state=open]:animate-none"
      >
        <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-cream-muted">Viewport</p>
        {viewportOptions.map((option) => {
          const Icon = option.icon;
          const selected = option.id === props.value;
          return (
            <button
              key={option.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
                "transition-colors hover:bg-charcoal-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-active/40",
                selected && "bg-charcoal-hover text-cream",
              )}
              aria-pressed={selected}
              onClick={() => props.onChange(option.id)}
            >
              <Icon size={16} strokeWidth={1.8} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{option.label}</span>
                <span className="block text-[11px] text-cream-muted">{option.detail}</span>
              </span>
              {selected ? <Check size={14} aria-hidden /> : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
