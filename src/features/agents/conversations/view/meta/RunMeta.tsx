// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import "./runMeta.css";
import type { GlobalAiMessage } from "../../state/conversationTypes";
import { formatDuration, formatUsage, modelDisplayName } from "./format";

/** What a finished run took: its time, its tokens and the model that answered, in one muted
 * line under the answer that shows while the answer is hovered or focused. */
export function RunMeta({ message }: { message: GlobalAiMessage }) {
  const parts = [
    formatDuration(message.durationMs),
    formatUsage(message.usage),
    message.model ? modelDisplayName(message.model) : null,
  ].filter((part): part is string => Boolean(part));
  if (!parts.length) return null;
  return (
    <p className="agent-run-meta" aria-label={`Run details: ${parts.join(", ")}`}>
      {parts.join(" · ")}
    </p>
  );
}
