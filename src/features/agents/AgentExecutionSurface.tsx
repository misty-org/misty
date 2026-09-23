import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import {
  finishLocalExecution,
  routeLocalFollowup,
  continueQueuedLocalWork,
  pauseLocalExecution,
  steerLocalExecution,
  useLocalExecution,
} from "./localExecution";
import { Button } from "@/shared/ui";

import { TaskArtifacts } from "./TaskArtifactList";

const control =
  "rounded border border-charcoal-border bg-charcoal-card px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-cream-muted disabled:bg-charcoal-bg disabled:border-charcoal-border disabled:text-cream-muted disabled:cursor-not-allowed";
export function AgentExecutionSurface() {
  const execution = useLocalExecution((s) => s.execution);
  const agent = usePersonalAgentsStore((s) => s.agents.find((a) => a.id === execution?.agentId));
  const [active, setActive] = useState(0),
    [steering, setSteering] = useState(""),
    [error, setError] = useState("");
  const [routing, setRouting] = useState(false);
  useEffect(() => {
    if (execution?.state === "finished")
      void continueQueuedLocalWork(execution.taskId).catch((e) => setError(String(e)));
  }, [execution?.taskId, execution?.state]);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setActive(0);
  }, [execution?.taskId]);
  useEffect(() => {
    if (!execution) return;
    const remove = getCurrentWindow().listen<{ id: string }>(
      "misty://agent-target",
      ({ payload }) => {
        const index = execution.views.indexOf(payload.id);
        if (index >= 0) setActive(index);
      },
    );
    return () => {
      void remove.then((fn) => fn());
    };
  }, [execution]);
  useEffect(() => {
    if (!execution || execution.autopilot) return;
    let disposed = false;
    const layout = async () => {
      const rect = viewport.current?.getBoundingClientRect();
      if (!rect) return;
      await invoke("browser_webviews_hide_all");
      if (disposed) return;
      const id = execution.views[active];
      if (!id) return;
      await invoke("browser_webview_set_bounds", {
        request: { id, x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
      await invoke("browser_webview_show", { request: { id } });
      await invoke("browser_agent_set_locked", {
        request: { id },
        locked: execution.state === "running",
      });
    };
    void layout().catch((e) => setError(String(e)));
    const observer = new ResizeObserver(() => void layout().catch((e) => setError(String(e))));
    if (viewport.current) observer.observe(viewport.current);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [execution?.taskId, execution?.state, execution?.views.length, active]);
  useEffect(() => {
    if (!execution) return;
    const close = () => {
      void pauseLocalExecution();
    };
    window.addEventListener("pagehide", close);
    return () => window.removeEventListener("pagehide", close);
  }, [execution?.taskId]);
  if (!execution) return null;
  if (execution.autopilot) return null;
  const action = (task: () => Promise<unknown>) => {
    setError("");
    void task().catch((e) => setError(String(e)));
  };
  return (
    <section
      className="fixed inset-0 z-[2147482400] flex flex-col bg-charcoal-bg text-cream"
      aria-label={`${agent?.name ?? "Agent"} workspace`}
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-charcoal-border px-4">
        <strong className="mr-auto truncate text-sm">
          {agent?.name ?? "Agent"} ·{" "}
          {execution.state === "running"
            ? "Working"
            : execution.state === "paused"
              ? "Paused — you can use this page"
              : "Task finished — review the result"}
        </strong>
        <Button
          variant="ghost"
          className={control}
          onClick={() => useMistyStore.getState().openPanel()}
        >
          Chat
        </Button>
        {execution.state === "running" ? (
          <Button variant="ghost" className={control} onClick={() => action(pauseLocalExecution)}>
            Pause
          </Button>
        ) : (
          <Button
            variant="ghost"
            className={control}
            onClick={() =>
              action(() =>
                steerLocalExecution(
                  "Continue the current task. Inspect the current state first; do not repeat completed or uncertain writes.",
                ),
              )
            }
          >
            Resume
          </Button>
        )}
        <Button
          variant="ghost"
          className={control}
          onClick={() =>
            action(async () => {
              await pauseLocalExecution();
              useMistyStore.setState({ error: "Stopped. Completed changes have not been undone." });
            })
          }
        >
          Stop
        </Button>
        {execution.state !== "running" && (
          <Button variant="ghost" className={control} onClick={() => action(finishLocalExecution)}>
            Close workspace
          </Button>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={viewport} className="min-h-0 flex-1">
            <p className="p-5 text-sm text-cream-muted">
              {execution.views.length
                ? "Integration workspace"
                : "Working with native apps. Progress and results appear in chat."}
            </p>
          </div>
          <TaskArtifacts agentId={execution.agentId} spaceId={execution.spaceId} />
          <nav
            className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto px-3"
            aria-label="Task integrations"
          >
            {execution.context.map((view, index) => (
              <Button
                key={view.id}
                variant="ghost"
                className={control}
                aria-pressed={active === index}
                onClick={() => setActive(index)}
              >
                {view.title}
              </Button>
            ))}
          </nav>
        </div>
        <aside
          className="w-[440px] shrink-0 border-l border-charcoal-border"
          aria-label="Agent conversation"
        />
      </div>
      <form
        className="flex shrink-0 gap-2 border-t border-charcoal-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!steering.trim()) return;
          const prompt = steering;
          setSteering("");
          if (routing) return;
          setRouting(true);
          void routeLocalFollowup(prompt)
            .then(setError)
            .catch((e) => setError(String(e)))
            .finally(() => setRouting(false));
        }}
      >
        <label className="sr-only" htmlFor="agent-steering">
          Message this agent
        </label>
        <input
          id="agent-steering"
          className="min-w-0 flex-1 rounded bg-charcoal-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-cream-muted"
          value={steering}
          onChange={(e) => setSteering(e.target.value)}
          placeholder="Message this agent…"
        />
        <Button variant="ghost" className={control} disabled={routing || !steering.trim()}>
          {routing ? "Interpreting…" : "Send"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="px-4 pb-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
