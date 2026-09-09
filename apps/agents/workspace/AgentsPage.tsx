import { useMobileSurfaceChrome, useSurfacePresentation } from "@/shared/mobile";
import { cn } from "@/shared/ui";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AutomationsWorkspace } from "./automations/AutomationsWorkspace";
import { MistyWorkspace } from "./components/MistyWorkspace";
import { McpConnectionsSheet } from "./mcp/McpConnectionsSheet";

export default function DesktopAgentsPage() {
  const presentation = useSurfacePresentation();
  const mobile = presentation !== "desktop";
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const view = searchParams.get("view") === "automations" ? "automations" : "chat";
  const selectedAutomationId = searchParams.get("automation") ?? undefined;
  useMobileSurfaceChrome(mobile ? { title: "Agents", level: "root" } : null);

  const setView = (nextView: "chat" | "automations") => {
    const next = new URLSearchParams(searchParams);
    if (nextView === "automations") next.set("view", "automations");
    else {
      next.delete("view");
      next.delete("automation");
    }
    setSearchParams(next);
  };

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
        {mobile ? (
          <div className="grid min-h-12 grid-cols-2 gap-1 border-b border-charcoal-border bg-charcoal-workspace p-1.5">
            {(["chat", "automations"] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={view === item}
                className={cn(
                  "min-h-11 rounded-lg text-sm font-medium capitalize text-cream-muted",
                  view === item && "bg-charcoal-active text-cream-bright",
                )}
                onClick={() => setView(item)}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
        <div className={cn("min-h-0", mobile ? "h-[calc(100%-56px)]" : "h-full")}>
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
      </div>
      <McpConnectionsSheet open={connectionsOpen} onOpenChange={setConnectionsOpen} />
    </>
  );
}
