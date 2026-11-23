import { SplitHandle, SplitPane, SplitPanes } from "@misty/ui";
import type { ReactNode } from "react";

export function ChatStageSplit({ stage, children }: { stage: ReactNode; children: ReactNode }) {
  return (
    <SplitPanes direction="vertical" className="min-h-0 flex-1">
      <SplitPane defaultSize={55} minSize={25} className="flex min-h-0 flex-col">
        {stage}
      </SplitPane>
      <SplitHandle direction="vertical" label="Resize the call" seam />
      <SplitPane minSize={25} className="flex min-h-0 flex-col">
        {children}
      </SplitPane>
    </SplitPanes>
  );
}
