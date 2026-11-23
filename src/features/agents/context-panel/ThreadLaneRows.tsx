import { useCallback, useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { Button, notify, useConfirmDelete } from "@misty/ui";
import { invoke } from "@/native/invoke";
import { multirunApi, errorText } from "../multirun/multirun_api";
import { agentAccountId } from "../personal/agent_account";
import { Row } from "./SessionRows";

interface ThreadLane {
  multirun: string;
  lane: number;
  branch: string;
  folder: string;
  project: string;
}

const projectName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function ThreadLaneRows(props: { conversationId: string; working: boolean }) {
  const [lane, setLane] = useState<ThreadLane | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirmDelete();

  const load = useCallback(() => {
    if (!props.conversationId) return;
    void invoke<ThreadLane | null>("thread_lane_of", {
      account: agentAccountId(),
      conversation: props.conversationId,
    }).then(setLane, () => setLane(null));
  }, [props.conversationId]);

  useEffect(() => {
    load();
  }, [load, props.working]);

  if (!lane) return null;

  const keep = () => {
    setBusy(true);
    void multirunApi
      .keep(lane.multirun, lane.lane)
      .then(
        () => notify({ message: `This thread's changes are in ${projectName(lane.project)}` }),
        (reason: unknown) => notify({ message: errorText(reason), tone: "error" }),
      )
      .finally(() => setBusy(false));
  };

  const discard = () =>
    void confirm({
      title: "Discard this thread's changes?",
      what: `Its branch ${lane.branch} and every change on it are deleted. This can't be undone.`,
      confirmLabel: "Discard",
      onConfirm: async () => {
        await multirunApi.discard(lane.multirun);
        setLane(null);
      },
    });

  return (
    <>
      <Row
        icon={GitBranch}
        label={lane.branch}
        value={
          <span className="flex items-center gap-1">
            <Button variant="quiet" size="sm" disabled={busy || props.working} onClick={keep}>
              Keep changes
            </Button>
            <Button variant="quiet" size="sm" disabled={busy || props.working} onClick={discard}>
              Discard
            </Button>
          </span>
        }
      />
      {dialog}
    </>
  );
}
