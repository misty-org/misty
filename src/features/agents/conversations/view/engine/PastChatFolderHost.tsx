import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Button,
  ChoiceList,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Text,
} from "@/shared/ui";
import { folderName } from "../../../engines/enginesApi";
import { usePersonalAgentsStore } from "../../../personal/personalAgentsStore";
import { giveHistoryFolder } from "../../../shared-folders/folderAgents";
import { usePastChatAsk, type PastChat, type PastChatAgent } from "./pastChats";

const newAgent = "new";

/**
 * Asks which agent gets the folder a past chat ran in, when no agent on its engine works there
 * yet (`agentForPastChat`). Mounted once for the app.
 */
export function PastChatFolderHost() {
  const asking = usePastChatAsk((state) => state.asking);
  if (!asking) return null;
  return (
    <PastChatFolderDialog
      key={`${asking.chat.engine}:${asking.chat.sessionId}`}
      chat={asking.chat}
      preferred={asking.preferred}
      onDone={asking.answer}
    />
  );
}

/**
 * The folder, the agents on the chat's engine and a new one to choose from, then Cancel and
 * Give folder. The system's own dialog asks once more before the folder is the agent's.
 */
function PastChatFolderDialog({
  chat,
  preferred,
  onDone,
}: {
  chat: PastChat;
  preferred?: string;
  onDone(agent: PastChatAgent | null): void;
}) {
  const agents = usePersonalAgentsStore(
    useShallow((state) =>
      state.agents.filter((agent) => agent.engine === chat.engine && !agent.system_managed),
    ),
  );
  const [picked, setPicked] = useState(() =>
    preferred && agents.some((agent) => agent.id === preferred)
      ? preferred
      : (agents[0]?.id ?? newAgent),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const give = async () => {
    setBusy(true);
    setError("");
    try {
      const given = await giveHistoryFolder(
        chat.workspacePath,
        chat.engine,
        picked === newAgent ? undefined : picked,
      );
      if (given) onDone(given);
      else setBusy(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onDone(null);
      }}
    >
      <DialogContent size="sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Give this folder to an agent</DialogTitle>
        </DialogHeader>
        <div className="grid min-w-0 gap-1">
          <Text size="body" weight="medium" full>
            {folderName(chat.workspacePath)}
          </Text>
          <Text size="meta" tone="muted" full>
            {chat.workspacePath}
          </Text>
        </div>
        <ChoiceList
          label="Agent"
          options={[
            ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
            { value: newAgent, label: "New agent" },
          ]}
          selected={[picked]}
          onSelect={setPicked}
          disabled={busy}
        />
        {error ? (
          <Text size="meta" tone="danger" wrap role="alert">
            {error}
          </Text>
        ) : null}
        <DialogFooter>
          <Button variant="quiet" size="lg" disabled={busy} onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" loading={busy} onClick={() => void give()}>
            Give folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
