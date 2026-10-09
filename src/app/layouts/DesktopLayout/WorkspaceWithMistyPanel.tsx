import { useEffect, useRef, type ReactNode } from "react";
import { MistyPanel, useMistyPanelStore, type MistyPanelSide } from "@/features/agents";
import { useSettingsStore } from "@/features/settings";
import { cn } from "@/shared/ui";
import { usePageBackgroundBeside } from "./usePageBackgroundBeside";

/** The workspace with the Misty panel docked on the side chosen in settings. */
export function WorkspaceWithMistyPanel(props: { children: ReactNode }) {
  const open = useMistyPanelStore((s) => s.open);
  const side: MistyPanelSide =
    (useSettingsStore((s) => s.settings?.document.agent) as { panel_side?: string } | undefined)
      ?.panel_side === "left"
      ? "left"
      : "right";
  const workspaceRef = useRef<HTMLDivElement>(null);
  const pageBeside = usePageBackgroundBeside(workspaceRef, side, open);
  const extendsPage = Boolean(pageBeside);
  useEffect(() => {
    window.dispatchEvent(new Event("misty:workspace-geometry-changed"));
  }, [open, side, extendsPage]);
  return (
    <div
      className={cn(
        "flex h-full w-full min-h-0 min-w-0 overflow-hidden",
        open && "bg-charcoal-bg",
        side === "left" && "flex-row-reverse",
      )}
    >
      {/* Beside the Misty panel the workspace rounds its facing edge;
          browser pages that reach those corners round to match. A dark
          page along that edge instead continues into the panel. */}
      <div
        ref={workspaceRef}
        className={cn(
          "h-full min-h-0 min-w-0 flex-1 overflow-hidden",
          open && !extendsPage && (side === "left" ? "rounded-l-xl" : "rounded-r-xl"),
        )}
        data-browser-corner-clip=""
      >
        {props.children}
      </div>
      {open ? <MistyPanel side={side} background={pageBeside} /> : null}
    </div>
  );
}
