import { useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useTaskArtifacts } from "./taskArtifacts";
import { Button } from "@/shared/ui";

const status = {
  downloading: "Downloading",
  saving: "Saving to the Space",
  saved: "",
  failed: "Didn’t download",
} as const;

/** This task's downloads, and whether each reached the agent's Space. */
export function TaskArtifacts({ taskId }: { taskId: string }) {
  const items = useTaskArtifacts((s) => s.items).filter((item) => item.taskId === taskId);
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
          <span className="shrink-0 text-cream-muted">
            {item.state === "saved"
              ? `Saved to ${item.spaceName ?? "the Space"}`
              : item.state === "failed" && item.downloaded
                ? "Not saved to the Space"
                : status[item.state]}
          </span>
          {item.downloaded ? (
            <Button
              variant="link"
              className="h-auto p-0 text-xs underline"
              onClick={() => void openPath(item.path).catch((reason) => setError(String(reason)))}
            >
              Open
            </Button>
          ) : null}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
