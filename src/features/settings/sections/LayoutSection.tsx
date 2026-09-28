import { useId, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { Button, cn, IconButton, Input, Pressable, SegmentedControl } from "@/shared/ui";
import {
  dockingPresets,
  dockPositions,
  useDockingLayoutStore,
  type DockingLayout,
  type DockPosition,
} from "@/features/app-shell/dockingLayout";

import { useWorkspaceStore, useWindowDockingLayout } from "@/features/workspace";
import "./dockingLayout.css";

export function LayoutSection() {
  const windowId = useWorkspaceStore((state) => state.activeVirtualWindowId);
  return <WindowLayoutEditor key={windowId} />;
}

function WindowLayoutEditor() {
  const layout = useWindowDockingLayout();
  const setLayout = useWorkspaceStore((state) => state.setWindowDockingLayout);
  const windowName = useWorkspaceStore(
    (state) =>
      state.virtualWindowsByScope[state.activeScopeKey]?.find(
        (window) => window.id === state.activeVirtualWindowId,
      )?.title ?? "this window",
  );
  const { savedLayouts, saveLayout, removeLayout } = useDockingLayoutStore();
  const setPosition = (part: keyof DockingLayout, position: DockPosition) =>
    setLayout({ ...layout, [part]: position });
  const nameId = useId();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  return (
    <section aria-label="Window layout" className="min-w-0">
      <h2 className="text-sm font-semibold text-cream">Layout for {windowName}</h2>
      <p className="mt-1 mb-5 text-[13px] leading-relaxed text-cream-muted">
        Changes apply immediately to this virtual window. Other windows keep their own layouts.
      </p>
      <div>
        <h3 className="mb-2 text-xs text-cream-muted">Start with a preset</h3>
        <div className="mb-6 grid grid-cols-2 gap-2 min-[1100px]:grid-cols-4">
          {dockingPresets.map((preset) => (
            <Pressable
              key={preset.id}
              aria-pressed={layout.navigation === preset.navigation && layout.tabs === preset.tabs}
              className={cn(
                "flex items-center hover:bg-cream/[0.045] rounded-md",
                "flex-col items-stretch gap-[7px] border-charcoal-border p-[9px]",
                "text-xs text-cream-muted aria-pressed:border-cream-muted aria-pressed:text-cream-bright",
              )}
              onClick={() => {
                setLayout(preset);
                setMessage("");
              }}
            >
              <LayoutPreview layout={preset} />
              <span>{preset.name}</span>
            </Pressable>
          ))}
        </div>
        {(["navigation", "tabs"] as const).map((part) => (
          <fieldset key={part} className="mb-5 max-w-md">
            <legend className="mb-2 text-xs font-medium">
              {part === "navigation" ? "Navigation" : "Tabs"}
            </legend>
            <SegmentedControl
              fill
              label={`${part === "navigation" ? "Navigation" : "Tabs"} position`}
              value={layout[part]}
              options={dockPositions.map((position) => {
                const other = part === "navigation" ? "tabs" : "navigation";
                const occupied = layout[other] === position;
                return {
                  value: position,
                  label: <span className="capitalize">{position}</span>,
                  ariaLabel: position,
                  disabled: occupied,
                  title: occupied ? `Already used by ${other}` : undefined,
                };
              })}
              onChange={(position) => {
                setPosition(part, position);
                setMessage("");
              }}
            />
          </fieldset>
        ))}
        <p className="mb-4 text-xs leading-relaxed text-cream-muted">
          Navigation and tabs use different edges. Side tabs keep New tab at the top.
        </p>
        <Button
          variant="link"
          size="none"
          className="text-xs text-cream-muted underline"
          onClick={() => {
            setLayout(dockingPresets[0]);
            setMessage("");
          }}
        >
          Reset to Classic
        </Button>
        {savedLayouts.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-xs text-cream-muted">Saved layouts</h3>
            {savedLayouts.map((saved) => (
              <div key={saved.id} className="flex min-w-0 items-center gap-1">
                <Button
                  variant="ghost"
                  justify="start"
                  className="min-w-0 flex-1 text-xs"
                  onClick={() => {
                    setLayout(saved);
                    setName(saved.name);
                    setMessage("");
                  }}
                >
                  <span className="truncate">{saved.name}</span>
                </Button>
                <IconButton
                  label={`Delete layout ${saved.name}`}
                  onClick={() => removeLayout(saved.id)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
      <form
        className="mt-6 border-t border-charcoal-border pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (saveLayout(name, layout)) setMessage(`Saved “${name.trim()}”`);
        }}
      >
        <label htmlFor={nameId} className="mb-2 block text-xs text-cream-muted">
          Save as a preset
        </label>
        <Input
          id={nameId}
          className="max-w-md text-xs"
          value={name}
          maxLength={40}
          placeholder="My workspace"
          onChange={(event) => {
            setName(event.target.value);
            setMessage("");
          }}
        />
        <Button type="submit" disabled={!name.trim()} className="mt-3 flex">
          <Check size={16} />
          Save preset
        </Button>
        <p role="status" className="mt-2 min-h-4 text-[11px] text-cream-muted">
          {message || "Saved presets are available to all windows on this device."}
        </p>
      </form>
    </section>
  );
}
function LayoutPreview({ layout }: { layout: DockingLayout }) {
  return (
    <span aria-hidden="true" className="misty-docking-preview">
      <span className={cn("preview-navigation", `edge-${layout.navigation}`)} />
      <span className={cn("preview-tabs", `edge-${layout.tabs}`, `nav-${layout.navigation}`)} />
    </span>
  );
}
