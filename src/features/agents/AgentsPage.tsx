import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AutomationsWorkspace } from "./automations/AutomationsWorkspace";
import { MistyWorkspace } from "./components/MistyWorkspace";
import { McpConnectionsSheet } from "./mcp/McpConnectionsSheet";

export default function DesktopAgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const view = searchParams.get("view") === "automations" ? "automations" : "chat";
  const selectedAutomationId = searchParams.get("automation") ?? undefined;

  const createWithMisty = (draft?: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("view");
    next.delete("automation");
    next.set(
      "draft",
      draft ??
        "Help me create an automation. Ask what should trigger it and what should happen, then build and test it in Misty's automation workspace. Do not publish it until I approve.",
    );
    setSearchParams(next);
  };

  const selectAutomation = (flowId?: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("view", "automations");
    if (flowId) next.set("automation", flowId);
    else next.delete("automation");
    setSearchParams(next);
  };

  return (
    <>
      <div className="h-full min-h-0 overflow-hidden bg-charcoal-bg">
        {view === "chat" ? (
          <MistyWorkspace
            requestedConversationId={searchParams.get("conversation") ?? undefined}
            requestedDraft={searchParams.get("draft") ?? undefined}
            onManageConnections={() => setConnectionsOpen(true)}
          />
        ) : (
          <AutomationsWorkspace
            selectedFlowId={selectedAutomationId}
            onSelectedFlowChange={selectAutomation}
            onCreateWithMisty={createWithMisty}
          />
        )}
      </div>
      <McpConnectionsSheet open={connectionsOpen} onOpenChange={setConnectionsOpen} />
    </>
  );
}
