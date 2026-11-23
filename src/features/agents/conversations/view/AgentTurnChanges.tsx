import { useMemo } from "react";
import { Button, TurnChanges } from "@misty/ui";
import type { AiProgressItem } from "../../runs/invocations/invocation_types";
import { openChatFilePath, useReplyFolder } from "../../runs/markdown/fileLinks/open_chat_file";
import { useContextPanel } from "../../context-panel/context_panel_store";
import { turnChanges } from "../../progress/turn_model";

export function AgentTurnChanges({ progress }: { progress: AiProgressItem[] | undefined }) {
  const folder = useReplyFolder();
  const show = useContextPanel((state) => state.show);
  const files = useMemo(() => turnChanges(progress), [progress]);
  return (
    <TurnChanges
      files={files.map((file) => ({
        ...file,
        onOpen: () => openChatFilePath(file.path, folder),
      }))}
      action={
        <Button size="sm" onClick={() => show("changes")}>
          Review changes
        </Button>
      }
    />
  );
}
