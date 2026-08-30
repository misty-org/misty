import { Button } from "@/shared/ui";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { returnToBrowseTab } from "./ExplorerDesktopPlugins";

/**
 * Wraps a file manager chrome tab (Transfers, Remotes) with a way back.
 *
 * The embedded file manager hides its own tab strip because the dock supplies
 * one, which leaves these tabs with no visible exit. The standalone route keeps
 * its tab strip, so it renders the panel unchanged.
 */
export function ChromeTabShell(props: {
  embedded?: boolean;
  label: string;
  homePath: string;
  children: ReactNode;
}) {
  if (!props.embedded) return <>{props.children}</>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-charcoal-border/60 px-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-cream-muted hover:text-cream-bright"
          aria-label="Back to files"
          onClick={() => returnToBrowseTab(props.homePath)}
        >
          <ArrowLeft size={16} />
          Files
        </Button>
        <span className="min-w-0 truncate text-sm text-cream-muted">{props.label}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{props.children}</div>
    </div>
  );
}
