import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minimize2, Square, SquareArrowDownLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { applyAppTheme } from "@/features/settings";
import { IconButton } from "@/shared/ui";

const parameters = new URLSearchParams(location.search);

/**
 * The window a detached tab works in. The page fills it below this bar; the
 * bar says what the agent is doing and holds Dock, Bring back and Stop. The
 * task itself runs in the person's window, which sends the status here.
 */
export function AgentDockHostRoot() {
  const title = parameters.get("title") ?? "";
  const agent = parameters.get("agent") || "Misty";
  const [status, setStatus] = useState("");
  const [docked, setDocked] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    applyAppTheme("system");
    const own = getCurrentWindow().label;
    const remove = getCurrentWindow().listen<{ action?: string; id?: string; status?: string }>(
      "misty://agent-dock",
      ({ payload }) => {
        if (payload.id !== own) return;
        if (payload.action === "status") setStatus(payload.status ?? "");
        else if (payload.action === "docked") setDocked(true);
        else if (payload.action === "opened") setDocked(false);
      },
    );
    return () => void remove.then((unlisten) => unlisten());
  }, []);

  const press = (action: "dock" | "attach" | "stop") => {
    setError("");
    void invoke("agent_dock_host_action", { action }).catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };

  return (
    <div
      className="flex h-11 items-center gap-1 border-b border-charcoal-border bg-charcoal-card px-3 text-cream"
      data-tauri-drag-region
    >
      <div className="min-w-0 flex-1" data-tauri-drag-region>
        <p className="truncate text-sm">{title}</p>
        <p className="truncate text-xs text-cream-muted" role={error ? "alert" : "status"}>
          {error || status || `${agent} is working in this tab`}
        </p>
      </div>
      {!docked && (
        <IconButton size="md" label="Dock" onClick={() => press("dock")}>
          <Minimize2 className="size-4" />
        </IconButton>
      )}
      <IconButton size="md" label="Bring back to your window" onClick={() => press("attach")}>
        <SquareArrowDownLeft className="size-4" />
      </IconButton>
      <IconButton size="md" label="Stop task" onClick={() => press("stop")}>
        <Square className="size-4" />
      </IconButton>
    </div>
  );
}
