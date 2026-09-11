import { ActivityPanelToolbar } from "./ActivityPanelToolbar";
import { ActivityPanelFooter } from "./ActivityPanelFooter";
import { defaultActivityView, selectActivityView } from "./activityView";
import { useActivityStore } from "./useActivityStore";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui";
import { useAuth } from "@/features/auth";
import { CapabilityApprovalDetail } from "@/features/capability-approvals/CapabilityApprovals";
import { AgentInterventions } from "@/features/agent-interventions/AgentInterventions";
import { ActivityFeed } from "./ActivityFeed";
import { closeActivityPanel, openActivityPanel, useActivityPanel } from "./activityPanelState";

export function ActivityPanel() {
  const { user } = useAuth();
  const account = useRef(user?.id);
  const panel = useActivityPanel();
  const [view, setView] = useState(defaultActivityView);
  const items = useActivityStore((state) => state.allItems);
  const results = selectActivityView(items, view);
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
        className="flex h-[min(560px,75dvh)] max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden bg-charcoal-bg p-0 [&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-3"
      >
        <header className="flex min-h-12 shrink-0 items-center px-3 pr-12">
          <DialogTitle className="flex items-center gap-2.5 text-xl font-semibold">
            <Bell size={22} aria-hidden="true" />
            Activity
          </DialogTitle>
        </header>
        {!panel.approvalId && !panel.interventionId && (
          <ActivityPanelToolbar view={view} counts={results.counts} onChange={setView} />
        )}
        {panel.approvalId || panel.interventionId ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <button
              type="button"
              className="min-h-11 text-sm text-cream-muted hover:text-cream-bright"
              onClick={() => openActivityPanel()}
            >
              Back to Activity
            </button>
            {user?.id && panel.approvalId ? (
              <CapabilityApprovalDetail
                key={`${user.id}:${panel.approvalId}`}
                id={panel.approvalId}
                onClose={() => openActivityPanel()}
              />
            ) : null}
            {user?.id && panel.interventionId ? (
              <AgentInterventions
                key={`${user.id}:${panel.interventionId}`}
                accountId={user.id}
                selectedId={panel.interventionId}
                onCount={() => undefined}
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
