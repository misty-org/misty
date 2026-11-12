import { createContext, useContext } from "react";
import { GitBranch } from "lucide-react";
import { IconButton } from "@/shared/ui";

/** What the transcript needs from a chat on an outside engine: how to fork it at a message. */
export interface EngineChat {
  fork(messageId: string): void;
}

export const EngineChatContext = createContext<EngineChat | undefined>(undefined);

/**
 * Forks the chat at one of the person's messages: a new chat whose engine session holds the
 * history before it, with the message in the composer to send again or change.
 */
export function EngineForkButton({ messageId }: { messageId: string }) {
  const chat = useContext(EngineChatContext);
  if (!chat) return null;
  return (
    <IconButton label="Fork from here" variant="toolbar" onClick={() => chat.fork(messageId)}>
      <GitBranch className="size-3.5" />
    </IconButton>
  );
}
