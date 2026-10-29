import { ModelKeyNeededButton, needsModelKey } from "@/features/settings/models/ModelKeyNeeded";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import { continueQueuedLocalWork, pauseLocalExecution, useLocalExecution } from "./localExecution";
import { Button, ViewportLayer } from "@/shared/ui";
import { AgentControlIsland } from "./AgentControlIsland";

import { TaskArtifacts } from "./TaskArtifactList";

export function AgentExecutionSurface() {
  const execution = useLocalExecution((s) => s.execution);
  const agent = usePersonalAgentsStore((s) => s.agents.find((a) => a.id === execution?.agentId));
  const [active, setActive] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    if (execution?.state === "finished" && !execution.normalTabs)
      void continueQueuedLocalWork(execution.taskId).catch((e) => setError(String(e)));
    // Continue queued work once per finish, not whenever the execution object is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!execution || execution.autopilot || execution.normalTabs) return;
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
    // Re-lay out only when the task, its state, or its views change, not on every progress update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execution?.taskId, execution?.state, execution?.views.length, active]);
  const executionTaskId = execution?.taskId;
  useEffect(() => {
    if (!executionTaskId) return;
    const close = () => {
      void pauseLocalExecution();
    };
    window.addEventListener("pagehide", close);
    return () => window.removeEventListener("pagehide", close);
  }, [executionTaskId]);
  // The island is the task's controls in every window, with or without this surface.
  if (!execution || execution.autopilot || execution.normalTabs) return <AgentControlIsland />;
  return (
    <>
      <ViewportLayer
        layer="agent-surface"
        role="region"
        className="flex flex-col bg-charcoal-bg text-cream"
        aria-label={`${agent?.name ?? "Agent"} workspace`}
      >
        <div className="flex min-h-0 flex-1 pb-36">
          <div className="flex min-w-0 flex-1 flex-col">
            <div ref={viewport} className="min-h-0 flex-1">
              <p className="p-5 text-sm text-cream-muted">
                {execution.views.length
                  ? "Browser workspace"
                  : "Working with native apps. Progress and results appear in chat."}
              </p>
            </div>
            <TaskArtifacts taskId={execution.taskId} />
            <nav
              className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto px-3"
              aria-label="Task browser tabs"
            >
              {execution.context.map((view, index) => (
                <Button
                  key={view.id}
                  variant="outline"
                  size="sm"
                  aria-pressed={active === index}
                  onClick={() => setActive(index)}
                >
                  {view.title}
                </Button>
              ))}
            </nav>
          </div>
        </div>
        {error && (
          <div role="alert" className="flex items-center gap-3 px-4 pb-3 text-sm text-cream-muted">
            <p className="m-0">{error}</p>
            {needsModelKey(error) && <ModelKeyNeededButton />}
          </div>
        )}
      </ViewportLayer>
      <AgentControlIsland />
    </>
  );
}
