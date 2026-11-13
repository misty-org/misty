// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * The bot fields in an agent's editor: its soul, the tools and MCP servers it may use,
 * and how an outside engine starts it. Under them, the prompt the run gets, built by the same
 * function the run uses, and the bot folder export.
 */
import { useState } from "react";
import type { AgentProfile, AgentProfileInput } from "@/shared/schemas";
import { Button, useNotice, Field, Input, Surface, Text, Textarea } from "@/shared/ui";
import { exportBotBundle } from "./botBundle";
import { assembleAgentPrompt, duplicateProseLines, proseOverLimit, PROSE_LIMIT } from "./botPrompt";

const listText = (values?: string[]) => (values ?? []).join(", ");
const listOf = (text: string) => [
  ...new Set(
    text
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
  ),
];

export function AgentBotFields({
  draft,
  onChange,
}: {
  draft: AgentProfileInput;
  onChange<K extends keyof AgentProfileInput>(key: K, value: AgentProfileInput[K]): void;
}) {
  const [tools, setTools] = useState(listText(draft.tools));
  const [servers, setServers] = useState(listText(draft.mcp_servers));
  const [args, setArgs] = useState((draft.runtime_args ?? []).join("\n"));
  const duplicates = duplicateProseLines(draft);
  const preview = assembleAgentPrompt({ agent: draft });
  return (
    <>
      <Field label="Soul">
        <Textarea
          className="min-h-32 resize-y"
          maxLength={100000}
          placeholder="Who this agent is: its voice, values and way of thinking"
          value={draft.soul ?? ""}
          onChange={(event) => onChange("soul", event.target.value)}
        />
      </Field>
      <Field label="Tools it may use">
        <Input
          placeholder="Every tool"
          value={tools}
          onChange={(event) => setTools(event.target.value)}
          onBlur={() => onChange("tools", listOf(tools))}
        />
      </Field>
      <Field label="MCP servers">
        <Input
          placeholder="None"
          value={servers}
          onChange={(event) => setServers(event.target.value)}
          onBlur={() => onChange("mcp_servers", listOf(servers))}
        />
      </Field>
      {draft.engine && draft.engine !== "misty" ? (
        <Field label="Engine arguments">
          <Textarea
            variant="code"
            className="resize-y"
            placeholder="One per line"
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            onBlur={() =>
              onChange(
                "runtime_args",
                args
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
      ) : null}
      <details className="py-1">
        <Text as="summary" bare size="control" tone="muted" className="cursor-pointer">
          {proseOverLimit(draft)
            ? `Prompt preview, over ${PROSE_LIMIT.toLocaleString()} characters`
            : duplicates.length
              ? "Prompt preview, with lines in both soul and instructions"
              : "Prompt preview"}
        </Text>
        <Surface
          as="pre"
          tone="card"
          radius="lg"
          className="m-0 max-h-72 overflow-auto whitespace-pre-wrap p-3 text-xs"
        >
          <Text bare tone="default">
            {preview.text || "Nothing yet"}
          </Text>
        </Surface>
      </details>
    </>
  );
}

/** Export an agent as a bot folder. */
export function ExportBotButton({ agent }: { agent: AgentProfile }) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  return (
    <>
      <Button
        type="button"
        disabled={state === "working"}
        onClick={() => {
          setState("working");
          setError("");
          exportBotBundle(agent)
            .then((folder) => setState(folder ? "done" : "idle"))
            .catch((reason) => {
              setState("idle");
              setError(String(reason));
            });
        }}
      >
        {state === "done" ? "Exported" : "Export as bot"}
      </Button>
    </>
  );
}
