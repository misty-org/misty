import { useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useTaskArtifacts } from "./taskArtifacts";
export function TaskArtifacts({ agentId, spaceId }: { agentId: string; spaceId: string }) {
  const items = useTaskArtifacts((s) => s.items).filter(
    (item) => item.agentId === agentId && item.spaceId === spaceId,
  );
  const [error, setError] = useState("");
  if (!items.length) return null;
  return (
    <section
      className="max-h-36 overflow-auto border-t border-charcoal-border px-3 py-2 text-xs"
      aria-label="Task files"
    >
      <h3 className="font-medium">Task files</h3>
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2 py-1">
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          {item.state === "ready" ? (
            <button
              className="underline"
              onClick={() => void openPath(item.path).catch((reason) => setError(String(reason)))}
            >
              Open
            </button>
          ) : (
            <span>{item.state === "pending" ? "Downloading…" : "Failed"}</span>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
