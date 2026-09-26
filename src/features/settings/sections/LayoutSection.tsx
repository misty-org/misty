import { useId, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { Button, cn } from "@/shared/ui";
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
            <Button
              key={preset.id}
              variant="ghost"
              size="none"
              aria-pressed={layout.navigation === preset.navigation && layout.tabs === preset.tabs}
              className="misty-docking-preset"
              onClick={() => {
                setLayout(preset);
                setMessage("");
              }}
            >
              <LayoutPreview layout={preset} />
              <span>{preset.name}</span>
            </Button>
          ))}
        </div>
        {(["navigation", "tabs"] as const).map((part) => (
          <fieldset key={part} className="mb-5 max-w-md">
            <legend className="mb-2 text-xs font-medium">
              {part === "navigation" ? "Navigation" : "Tabs"}
            </legend>
            <div className="misty-docking-positions">
              {dockPositions.map((position) => {
                const occupied = layout[part === "navigation" ? "tabs" : "navigation"] === position;
                return (
                  <Button
                    key={position}
                    variant="ghost"
                    size="none"
                    disabled={occupied}
                    aria-pressed={layout[part] === position}
                    title={
                      occupied
                        ? `Already used by ${part === "navigation" ? "tabs" : "navigation"}`
                        : undefined
                    }
                    onClick={() => {
                      setPosition(part, position);
                      setMessage("");
                    }}
                    className="capitalize"
                  >
                    {position}
                  </Button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <p className="mb-4 text-xs leading-relaxed text-cream-muted">
          Navigation and tabs use different edges. Side tabs keep New tab at the top.
        </p>
        <Button
          variant="ghost"
          size="none"
          className="text-xs underline underline-offset-4"
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete layout ${saved.name}`}
                  onClick={() => removeLayout(saved.id)}
                >
                  <Trash2 size={14} />
                </Button>
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
        <input
          id={nameId}
          className="h-9 w-full max-w-md rounded-md border border-charcoal-border bg-charcoal-bg px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-cream-muted"
          value={name}
          maxLength={40}
          placeholder="My workspace"
          onChange={(event) => {
            setName(event.target.value);
            setMessage("");
          }}
        />
        <Button
          type="submit"
          variant="ghost"
          disabled={!name.trim()}
          className="mt-3 flex bg-cream text-charcoal-bg hover:bg-cream-bright hover:text-charcoal-bg disabled:opacity-40"
        >
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
