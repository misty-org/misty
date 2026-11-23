import { SplitHandle, SplitPane, SplitPanes } from "@misty/ui";
import type { ReactNode } from "react";

export function ChatStageSplit({ stage, children }: { stage?: ReactNode; children: ReactNode }) {
  return (
    <SplitPanes direction="vertical" autoSaveId="space-chat-call" className="min-h-0 flex-1">
      {stage ? (
        <>
          <SplitPane
            id="stage"
            order={1}
            defaultSize={55}
            minSize={25}
            className="flex min-h-0 flex-col"
          >
            {stage}
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
