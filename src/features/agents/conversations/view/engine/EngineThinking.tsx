// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import { useId, useState } from "react";
import { Brain } from "lucide-react";
import { Text, ToolBody, ToolList, ToolRow } from "@misty/ui";
import { Fold } from "../../../progress/WorkGroup";

/** The reasoning's first words, for the folded row: one line, Markdown marks dropped. */
function summaryOf(text: string) {
  const line = text
    .replace(/[`*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > 80 ? `${line.slice(0, 80).trimEnd()}…` : line;
}

/**
 * The engine's reasoning, as one row like a tool's (after OpenChamber's reasoning part): "Thinking"
 * while it streams, then "Thought" with its first words. The row opens to the whole text.
 */
export function EngineThinking({ text, answering }: { text: string; answering: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <ToolList label="Reasoning">
      <li>
        <ToolRow
          icon={Brain}
          name={answering ? "Thought" : "Thinking"}
          target={answering && !open ? summaryOf(trimmed) : undefined}
          state={answering ? "done" : "running"}
          open={open}
          onToggle={() => setOpen(!open)}
          controls={bodyId}
        />
        <Fold id={bodyId} open={open} onReveal={() => setOpen(true)}>
          <ToolBody onFold={() => setOpen(false)}>
            <Text
              wrap
              size="meta"
              tone="muted"
              className="m-0 max-h-80 overflow-y-auto leading-[1.6] whitespace-pre-wrap"
            >
              {trimmed}
            </Text>
          </ToolBody>
        </Fold>
      </li>
    </ToolList>
  );
}
