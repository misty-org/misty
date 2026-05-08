import { AgentsPage } from "@/features/agents";
import { BrowserWorkspace } from "@/features/browser";
import { DeveloperWorkspace } from "@/features/developer-workspace";
import { ExtensionsPage } from "@/features/extensions";
import FilesPage from "@/features/files/explorer";
import { HomeDashboard } from "@/features/home";
import { TerminalWorkspace } from "@/features/terminal";
import { TransfersPage } from "@/features/transfers";
import type { WorkspaceTab } from "@/features/workspace";
import { cn } from "@/shared/ui";
import { Plus } from "lucide-react";

/** Static surface for a workspace tab that isn't the currently-routed one. */
export function WorkspaceSurface({ tab }: { tab: WorkspaceTab }) {
  switch (tab.surfaceId) {
    case "home":
      return <HomeDashboard />;
    case "browser":
      return <BrowserWorkspace tab={tab} />;
    case "terminal":
      return <TerminalWorkspace tab={tab} />;
    case "code":
      return <DeveloperWorkspace />;
    case "files":
      return <FilesPage embedded workspaceId={tab.id} workspaceTitle={tab.title} />;
    case "transfers":
      return <TransfersPage />;
    case "agents":
      return <AgentsPage />;
    case "extensions":
      return <ExtensionsPage />;
    case "space":
      // Rendered by the router outlet once the pane is focused. Inert here
      // so we don't race route redirects.
      return <div className="h-full bg-charcoal-bg" />;
  }
}

export function EmptyWorkspacePane({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="grid h-full place-items-center bg-charcoal-bg text-cream-muted">
      <button
        type="button"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-charcoal-border",
          "bg-charcoal-card px-4 py-2 text-sm hover:border-charcoal-active hover:text-cream",
        )}
        onClick={onOpen}
      >
        <Plus size={16} /> Open a workspace or tool
      </button>
    </div>
  );
}
