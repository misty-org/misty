import { useEffect } from "react";
import { CloudOff, FileWarning } from "lucide-react";
import { Button, ComposerStatusRow, notify } from "@misty/ui";
import { clashPrompt, useThread, useThreadWork, type ClashChoice } from "./thread_work";

const ASKED = "misty:thread-clashes-asked";

const clashKey = (conversationId: string, paths: string[]) =>
  `${conversationId}:${[...paths].sort().join("\n")}`;

function claimAsk(key: string): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(ASKED) ?? "[]") as string[];
    if (all.includes(key)) return false;
    localStorage.setItem(ASKED, JSON.stringify([...all.slice(-49), key]));
    return true;
  } catch {
    return true;
  }
}

function releaseAsk(key: string) {
  try {
    const all = JSON.parse(localStorage.getItem(ASKED) ?? "[]") as string[];
    localStorage.setItem(ASKED, JSON.stringify(all.filter((item) => item !== key)));
  } catch {
    return;
  }
}

const failed = (error: unknown) =>
  notify({ message: error instanceof Error ? error.message : String(error), tone: "error" });

export function ThreadStatusRows(props: {
  conversationId: string | undefined;
  working: boolean;
  onAsk(prompt: string): void;
}) {
  const conversationId = props.conversationId ?? "";
  const view = useThread(conversationId);
  const { onAsk, working } = props;

  const settle = (choice: ClashChoice) =>
    void useThreadWork.getState().resolve(conversationId, choice).catch(failed);

  const askAgent = () => {
    if (!view) return;
    const prompt = clashPrompt(view);
    void useThreadWork
      .getState()
      .resolve(conversationId, "agent")
      .then(() => onAsk(prompt))
      .catch(failed);
  };

  const clashed = view?.state === "clashed" && view.clashes.length > 0;
  const key = clashed
    ? clashKey(
        conversationId,
        view.clashes.map((clash) => clash.path),
      )
    : "";
  useEffect(() => {
    if (!clashed || working || !view || !claimAsk(key)) return;
    const prompt = clashPrompt(view);
    void useThreadWork
      .getState()
      .resolve(conversationId, "agent")
      .then(() => onAsk(prompt))
      .catch(() => releaseAsk(key));
  }, [clashed, working, key, view, conversationId, onAsk]);

  if (!view || !conversationId) return null;
  if (clashed) {
    const count = view.clashes.length;
    return (
      <ComposerStatusRow
        icon={FileWarning}
        actions={
          <>
            <Button variant="quiet" size="sm" disabled={working} onClick={askAgent}>
              Ask the agent
            </Button>
            <Button variant="quiet" size="sm" disabled={working} onClick={() => settle("mine")}>
              Keep mine
            </Button>
            <Button variant="quiet" size="sm" disabled={working} onClick={() => settle("theirs")}>
              Keep theirs
            </Button>
          </>
        }
      >
        {count === 1 ? `${view.clashes[0]!.path} clashes` : `${count} files clash`}
      </ComposerStatusRow>
    );
  }
  if (view.state === "held") {
    return (
      <ComposerStatusRow
        icon={CloudOff}
        actions={
          <Button
            variant="quiet"
            size="sm"
            disabled={working}
            onClick={() => void useThreadWork.getState().land(conversationId).catch(failed)}
          >
            Try again
          </Button>
        }
      >
        {view.note || "This turn's changes wait until the drive catches up"}
      </ComposerStatusRow>
    );
  }
  return null;
}
