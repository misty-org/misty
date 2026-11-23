// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import { useId, useState } from "react";
import { Text, ToolRow } from "@misty/ui";
import { Fold } from "../../../progress/WorkGroup";

function summaryOf(text: string) {
  return text
    .replace(/[`*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function EngineThinking({ text, answering }: { text: string; answering: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <div>
      <ToolRow
        name={answering ? "Thought" : "Thinking"}
        target={answering && !open ? summaryOf(trimmed) : undefined}
        state={answering ? "done" : "running"}
        open={open}
        onToggle={() => setOpen(!open)}
        controls={bodyId}
      />
      <Fold id={bodyId} open={open} onReveal={() => setOpen(true)}>
        <Text
          wrap
          size="meta"
          tone="muted"
          className="m-0 max-h-80 overflow-y-auto pb-2 leading-[1.6] whitespace-pre-wrap"
        >
          {trimmed}
        </Text>
      </Fold>
    </div>
  );
}
