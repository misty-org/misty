import type { ReactNode } from "react";
import { SplitHandle, SplitPane, SplitPanes } from "@misty/ui";
import { useAgentCallTranscript } from "./agent_call_store";
import { CallStageView } from "./CallView";

export function AgentCallSplit({
  conversationId,
  children,
}: {
  conversationId?: string;
  children: ReactNode;
}) {
  const { inCall: here, shown: transcript } = useAgentCallTranscript(conversationId);
  if (here && !transcript)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <CallStageView />
      </div>
    );
  return (
    <SplitPanes direction="vertical" autoSaveId="agent-chat-call" className="min-h-0 flex-1">
      {here ? (
        <>
          <SplitPane
            id="stage"
            order={1}
            defaultSize={55}
            minSize={25}
            className="flex min-h-0 flex-col"
          >
            <CallStageView />
          </SplitPane>
          <SplitHandle direction="vertical" label="Resize the call" seam />
        </>
      ) : null}
      <SplitPane id="chat" order={2} minSize={25} className="flex min-h-0 flex-col">
        {children}
      </SplitPane>
    </SplitPanes>
  );
}
