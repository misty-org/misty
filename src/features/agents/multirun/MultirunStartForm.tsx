import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorNotification,
  Label,
  Skeleton,
  Spinner,
  Textarea,
} from "@/shared/ui";
import { folderName, folderOf, listEngines, useSpaceFolders } from "../engines/enginesApi";
import type { EngineInfo } from "../engines/enginesApi";
import { agentAccountId } from "../personal/agentAccount";
import { AgentAvatar } from "../personal/AgentAvatar";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { errorText, multirunApi, type Multirun, type Readiness } from "./multirunApi";
import { laneChoices, maxLanes, readinessNotice, toggleChoice } from "./multirunLogic";
import { useMultirunStore } from "./multirunStore";

/**
 * Starts a multi-run: the task, and which of the person's agents take it. Each chosen agent gets
 * its own worktree of the Space's linked folder, so the folder has to be a Git repository.
 */
export function MultirunStartForm({
  space,
  onStarted,
  onCancel,
}: {
  space: string;
  onStarted(run: Multirun): void;
  /** Goes back to the multi-runs already there; absent when there are none. */
  onCancel?: () => void;
}) {
  const folder = useSpaceFolders((state) => folderOf(state, space));
  const agents = usePersonalAgentsStore((state) => state.agents);
  const [foldersRead, setFoldersRead] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [task, setTask] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void useSpaceFolders
      .getState()
      .load(space)
      .catch(() => [])
      .finally(() => setFoldersRead(true));
    void listEngines()
      .then(setEngines)
      .catch(() => setEngines([]));
    const known = usePersonalAgentsStore.getState();
    if (known.accountId !== agentAccountId()) void known.load(agentAccountId());
  }, [space]);

  const check = useCallback(() => {
    setReadiness(null);
    if (!folder) return;
    void multirunApi
      .check(folder)
      .then(setReadiness)
      .catch((reason) => setError(errorText(reason)));
  }, [folder]);
  useEffect(check, [check]);

  const choices = useMemo(() => laneChoices(agents, engines ?? []), [agents, engines]);
  const notice = foldersRead ? readinessNotice(folder, readiness) : null;
  const ready = foldersRead && Boolean(folder) && readiness === "ready" && engines !== null;

  const start = () => {
    setBusy(true);
    void useMultirunStore
      .getState()
      .start(space, folder, task, chosen)
      .then(onStarted)
      .catch((reason) => setError(errorText(reason)))
      .finally(() => setBusy(false));
  };

  if (notice)
    return (
      <>
        <EmptyState
          compact
          title={notice.title}
          action={
            notice.action === "link" ? (
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  void useSpaceFolders
                    .getState()
                    .link(space)
                    .catch(() => null)
                }
              >
                Link a folder
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={check}>
                Check again
              </Button>
            )
          }
        />
        <ErrorNotification message={error} onDismiss={() => setError("")} />
      </>
    );
  if (!ready)
    return (
      <div className="grid gap-3" aria-hidden={!error}>
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <ErrorNotification message={error} onDismiss={() => setError("")} />
      </div>
    );
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        start();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="multirun-task">Task</Label>
        <Textarea
          id="multirun-task"
          autoFocus
          className="min-h-28 resize-y"
          placeholder={`What should they do in ${folderName(folder)}?`}
          value={task}
          onChange={(event) => setTask(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <Label id="multirun-agents">Agents</Label>
          <span className="text-xs text-cream-muted">
            {chosen.length} of {maxLanes}
          </span>
        </div>
        <div className="grid gap-0.5" role="group" aria-labelledby="multirun-agents">
          {choices.map(({ agent, reason }) => {
            const on = chosen.includes(agent.id);
            const off = Boolean(reason) || (!on && chosen.length >= maxLanes);
            return (
              <label key={agent.id} className="multirun-agent" aria-disabled={off}>
                <Checkbox
                  checked={on}
                  disabled={off}
                  onCheckedChange={() => setChosen(toggleChoice(chosen, agent.id))}
                />
                <AgentAvatar agent={agent} compact />
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                {reason ? <span className="flex-none text-xs">{reason}</span> : null}
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={busy || !task.trim() || !chosen.length}>
          {busy ? <Spinner size="sm" label="Starting" /> : null}
          Start multi-run
        </Button>
      </div>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </form>
  );
}
