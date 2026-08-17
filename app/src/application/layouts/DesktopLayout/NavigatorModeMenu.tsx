import { hasTauriInternals } from "@/shared/platform/tauri";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@/shared/ui";
import { Check, PanelLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import type { NavigatorMode } from "./navigatorMode";

const modes: Array<{
  id: NavigatorMode;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  { id: "full", label: "Full", description: "Icons and labels", icon: PanelLeft },
  { id: "icons", label: "Icons", description: "Compact navigation rail", icon: PanelLeftClose },
  { id: "hidden", label: "Hidden", description: "Use the full workspace", icon: PanelLeftOpen },
];

export function NavigatorModeMenu(props: {
  mode: NavigatorMode;
  onModeChange: (mode: NavigatorMode) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [nativeMenuUnavailable, setNativeMenuUnavailable] = useState(false);
  const useNativeMenu = hasTauriInternals() && !nativeMenuUnavailable;

  if (useNativeMenu) {
    return (
      <NavigatorMenuButton
        mode={props.mode}
        className={props.className}
        onClick={() => {
          void openNativeNavigatorMenu(props.mode, props.onModeChange).catch(() => {
            setNativeMenuUnavailable(true);
            setOpen(true);
          });
        }}
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <NavigatorMenuButton mode={props.mode} className={props.className} />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-64 p-1.5">
        <div role="menu" aria-label="Navigation layout" className="grid gap-0.5">
          {modes.map((mode) => {
            const Icon = mode.icon;
            const selected = props.mode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={cn(
                  "grid min-h-12 grid-cols-[24px_minmax(0,1fr)_20px] items-center gap-2 rounded-md px-2.5 text-left",
                  selected
                    ? "bg-charcoal-card text-cream-bright"
                    : "text-cream-muted hover:bg-charcoal-card/70 hover:text-cream",
                )}
                onClick={() => {
                  props.onModeChange(mode.id);
                  setOpen(false);
                }}
              >
                <Icon size={17} strokeWidth={1.7} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{mode.label}</span>
                  <span className="block truncate text-[11px] text-cream-faint">
                    {mode.description}
                  </span>
                </span>
                {selected ? <Check size={15} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
        <p className="mb-1 mt-2 border-t border-charcoal-border px-2 pt-2 text-[10px] text-cream-faint">
          ⌘/Ctrl + Shift + B hides or restores navigation
        </p>
      </PopoverContent>
    </Popover>
  );
}

function NavigatorMenuButton(props: {
  mode: NavigatorMode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-7 place-items-center rounded-md border-0 bg-transparent p-0 text-cream-muted",
        "transition-colors hover:bg-charcoal-card hover:text-cream-bright",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-active",
        props.className,
      )}
      aria-label="Navigation layout"
      aria-haspopup="menu"
      title="Navigation layout (⌘⇧B)"
      data-misty-window-drag-block="true"
      onClick={props.onClick}
    >
      {props.mode === "full" ? (
        <PanelLeft size={17} />
      ) : props.mode === "icons" ? (
        <PanelLeftClose size={17} />
      ) : (
        <PanelLeftOpen size={17} />
      )}
    </button>
  );
}

async function openNativeNavigatorMenu(
  selectedMode: NavigatorMode,
  onModeChange: (mode: NavigatorMode) => void,
): Promise<void> {
  const [{ Menu }, { getCurrentWindow }] = await Promise.all([
    import("@tauri-apps/api/menu"),
    import("@tauri-apps/api/window"),
  ]);
  const menu = await Menu.new({
    items: modes.map((mode) => ({
      id: `navigator-mode-${mode.id}`,
      text: `${mode.label} — ${mode.description}`,
      checked: mode.id === selectedMode,
      action: () => onModeChange(mode.id),
    })),
  });
  try {
    await menu.popup(undefined, getCurrentWindow());
  } finally {
    await menu.close();
  }
}
