import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { AppWindow } from "./AppWindow";
import { MistyAppShell, type RailId } from "./MistyAppShell";
import { AgentView } from "./views/AgentView";
import { FilesView } from "./views/FilesView";
import { LibraryView } from "./views/LibraryView";
import { SpaceView } from "./views/SpaceView";

export type MockupView = "space" | "files" | "agent" | "library";

/**
 * Each surface pairs with the status line it earns.
 *
 * The left half of the status bar always states what stays private; the right
 * half states what the group can see. Reading the two halves together is the
 * whole pitch, which is why it lives in the chrome rather than in a headline.
 */
const views: Record<
  MockupView,
  {
    rail: RailId;
    space: string;
    body: ReactNode;
    status: { left: ReactNode; right: ReactNode };
  }
> = {
  space: {
    rail: "home",
    space: "Launch plan",
    body: <SpaceView />,
    status: {
      left: "Launch plan · 5 members",
      right: "34 shared items · everything else stays on your device",
    },
  },
  files: {
    rail: "files",
    space: "Launch plan",
    body: <FilesView />,
    status: {
      left: "2,418 files on this Mac · private to you",
      right: "2 shared with Launch plan",
    },
  },
  agent: {
    rail: "agents",
    space: "Launch plan",
    body: <AgentView />,
    status: {
      left: "Launch assistant · reads Launch plan only",
      right: "0 private files in context",
    },
  },
  library: {
    rail: "home",
    space: "Launch plan",
    body: <LibraryView />,
    status: {
      left: "Library · 34 items, shared with 5 members",
      right: "Added by the group, not synced from your disk",
    },
  },
};

/**
 * A live Misty window, drawn in DOM.
 *
 * Not a screenshot: it renders at device resolution, reflows on small
 * screens, stays readable to screen readers and to search engines, and can be
 * driven through states by scroll.
 *
 * `bodyClass` sets a fixed interior height. `fill` instead sizes the window to
 * whatever box the caller puts it in, which is what a grid of equal-height
 * cards wants: the window ends exactly where its slot ends, so nothing is
 * clipped mid-control and every card in a row lines up.
 */
export function MistyAppMockup({
  view = "space",
  className,
  bodyClass = "h-[380px]",
  fill = false,
  shadow = true,
}: {
  view?: MockupView;
  className?: string;
  bodyClass?: string;
  fill?: boolean;
  shadow?: boolean;
}) {
  const { rail, space, body, status } = views[view];

  return (
    <AppWindow
      title="Misty"
      className={cn("relative", fill && "h-full", className)}
      shadow={shadow}
    >
      <MistyAppShell
        rail={rail}
        activeSpace={space}
        status={status}
        className={fill ? "min-h-0 flex-1" : bodyClass}
      >
        {body}
      </MistyAppShell>
    </AppWindow>
  );
}
