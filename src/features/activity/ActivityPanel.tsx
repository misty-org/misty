import { ActivityPanelToolbar } from "./ActivityPanelToolbar";
import { ActivityPanelFooter } from "./ActivityPanelFooter";
import { defaultActivityView, selectActivityView } from "./activityView";
import { useActivityStore } from "./useActivityStore";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { cn, Button, Dialog, DialogContent, DialogTitle } from "@/shared/ui";
import { useAuth } from "@/features/auth";
import { AgentInterventions } from "@/features/agent-interventions/AgentInterventions";
import { AgentMemberRequests } from "@/features/agent-member-requests/AgentMemberRequests";
import { ActivityFeed } from "./ActivityFeed";
import { closeActivityPanel, openActivityPanel, useActivityPanel } from "./activityPanelState";

const noItems: ReturnType<typeof useActivityStore.getState>["allItems"] = [];

export function ActivityPanel() {
  const { user } = useAuth();
  const account = useRef(user?.id);
  const panel = useActivityPanel();
  const [view, setView] = useState(defaultActivityView);
  // The panel stays mounted while closed; only follow activity while it is open.
  const items = useActivityStore((state) => (panel.open ? state.allItems : noItems));
  const results = useMemo(() => selectActivityView(items, view), [items, view]);
  useEffect(() => {
    if (!panel.open) setView(defaultActivityView);
  }, [panel.open]);
  useEffect(() => {
    if (account.current !== user?.id) closeActivityPanel();
    account.current = user?.id;
  }, [user?.id]);
  return (
    <Dialog
      open={panel.open}
      onOpenChange={(open) => {
        if (!open) closeActivityPanel();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (document.querySelector('[role="menu"][data-state="open"]')) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          const trigger = document.querySelector<HTMLButtonElement>(
            'button[title="Activity"], button[aria-label^="Activity,"]',
          );
          if (trigger) {
            event.preventDefault();
            trigger.focus();
          }
        }}
        className={cn(
          "flex h-[min(560px,75dvh)] max-h-[calc(100dvh-2rem)] max-w-2xl flex-col",
          "gap-0 overflow-hidden bg-charcoal-bg p-0",
          "[&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-3",
        )}
      >
        <header className="flex min-h-12 shrink-0 items-center px-3 pr-12">
          <DialogTitle className="flex items-center gap-2.5 text-xl font-semibold">
            <Bell size={22} aria-hidden="true" />
            Activity
          </DialogTitle>
        </header>
        {!panel.interventionId && !panel.agentRequestId && (
          <ActivityPanelToolbar view={view} counts={results.counts} onChange={setView} />
        )}
        {panel.interventionId || panel.agentRequestId ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 text-cream-muted hover:text-cream-bright"
              onClick={() => openActivityPanel()}
            >
              Back to Activity
            </Button>
            {user?.id && panel.interventionId ? (
              <AgentInterventions
                key={`${user.id}:${panel.interventionId}`}
                accountId={user.id}
                selectedId={panel.interventionId}
                onCount={() => undefined}
              />
            ) : null}
            {user?.id && panel.agentRequestId ? (
              <AgentMemberRequests
                key={`${user.id}:${panel.agentRequestId}`}
                accountId={user.id}
                selectedId={panel.agentRequestId}
              />
            ) : null}
          </div>
        ) : (
          <>
            <ActivityFeed
              items={results.visible}
              narrowed={results.narrowed}
              onOpen={closeActivityPanel}
            />
            <ActivityPanelFooter results={results} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
