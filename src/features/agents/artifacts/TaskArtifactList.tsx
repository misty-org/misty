import { useState } from "react";
import { invoke } from "@/native/invoke";
import { useTaskArtifacts } from "./taskArtifacts";
import { Button, OverflowFadeText } from "@/shared/ui";
import { ErrorNotice } from "../conversations/ErrorNotice";

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
          <OverflowFadeText className="min-w-0 flex-1" full>
            {item.name}
          </OverflowFadeText>
          <span className="shrink-0 text-cream-muted">
            {item.state === "saved"
              ? `Saved to ${item.spaceName ?? "the Space"}`
              : item.state === "failed" && item.downloaded
                ? "Not saved to the Space"
                : status[item.state]}
          </span>
          {item.downloaded ? (
            <Button
              variant="quiet"
              className="h-auto p-0 text-xs underline"
              onClick={() =>
                void invoke("browser_tab_download_open", {
                  request: { tabId: item.tabId, downloadId: item.id },
                }).catch((reason) => setError(String(reason)))
              }
            >
              Open
            </Button>
          ) : null}
        </div>
      ))}
      <ErrorNotice message={error} onDismiss={() => setError("")} />
    </section>
  );
}
