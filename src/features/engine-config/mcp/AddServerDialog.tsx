/**
 * Adds an MCP server to one engine with the engine's own `mcp add` (native `engine_mcp_add`), so
 * the engine writes its own config. Values typed here (an env var, a header) go only to that
 * engine's CLI; Misty keeps none of them.
 */
import { useState } from "react";
import {
  Button,
  ChoiceGroup,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  Input,
  Textarea,
} from "@misty/ui";
import { mcpApi } from "./api";
import { engineLabel } from "./copy";
import type { McpEngineId } from "./types";

/** The engines whose CLI adds servers the way the native command speaks it. */
export const enginesThatAdd: readonly McpEngineId[] = ["claude", "codex"];

type Transport = "stdio" | "http";

/** `KEY=value` (or `Name: value`) lines into pairs; blank lines are skipped. */
function pairs(text: string, separator: "=" | ":"): [string, string][] | null {
  const out: [string, string][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(separator);
    if (at <= 0) return null;
    out.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  return out;
}

/** Splits a command line on spaces, keeping "quoted parts" whole. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

export function AddServerDialog({
  engine,
  open,
  onOpenChange,
  onAdded,
}: {
  engine: McpEngineId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [transport, setTransport] = useState<Transport>("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [env, setEnv] = useState("");
  const [headers, setHeaders] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");

  const reset = () => {
    setTransport("stdio");
    setName("");
    setCommand("");
    setUrl("");
    setEnv("");
    setHeaders("");
    setFailure("");
  };

  const submit = async () => {
    const envPairs = pairs(env, "=");
    const headerPairs = pairs(headers, ":");
    if (!envPairs) return setFailure("Write each variable as NAME=value, one per line.");
    if (!headerPairs) return setFailure("Write each header as Name: value, one per line.");
    const [program, ...args] = words(command);
    setSaving(true);
    setFailure("");
    try {
      await mcpApi.add({
        engine,
        name: name.trim(),
        target:
          transport === "stdio"
            ? { transport, command: program ?? "", args }
            : { transport, url: url.trim() },
        env: envPairs,
        headers: transport === "http" ? headerPairs : [],
      });
      reset();
      onAdded();
      onOpenChange(false);
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "The server couldn't be added.");
    } finally {
      setSaving(false);
    }
  };

  const ready =
    name.trim() !== "" && (transport === "stdio" ? command.trim() !== "" : url.trim() !== "");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{`Add a server to ${engineLabel(engine)}`}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form
            id="add-mcp-server"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && !saving) void submit();
            }}
          >
            <ChoiceGroup<Transport>
              label="How it connects"
              value={transport}
              onChange={setTransport}
              fill
              options={[
                { value: "stdio", label: "Command" },
                { value: "http", label: "Address" },
              ]}
            />
            <Field label="Name">
              <Input
                id="mcp-name"
                value={name}
                placeholder="github"
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            {transport === "stdio" ? (
              <Field label="Command">
                <Input
                  id="mcp-command"
                  value={command}
                  placeholder="npx -y @modelcontextprotocol/server-github"
                  autoComplete="off"
                  onChange={(event) => setCommand(event.target.value)}
                />
              </Field>
            ) : (
              <Field label="Address">
                <Input
                  id="mcp-url"
                  value={url}
                  placeholder="https://example.com/mcp"
                  autoComplete="off"
                  onChange={(event) => setUrl(event.target.value)}
                />
              </Field>
            )}
            <Field label="Environment">
              <Textarea
                id="mcp-env"
                value={env}
                rows={3}
                placeholder="GITHUB_TOKEN=…"
                spellCheck={false}
                onChange={(event) => setEnv(event.target.value)}
              />
            </Field>
            {transport === "http" && engine === "claude" ? (
              <Field label="Headers">
                <Textarea
                  id="mcp-headers"
                  value={headers}
                  rows={2}
                  placeholder="Authorization: Bearer …"
                  spellCheck={false}
                  onChange={(event) => setHeaders(event.target.value)}
                />
              </Field>
            ) : null}
            <FieldError message={failure} />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" size="lg" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            type="submit"
            form="add-mcp-server"
            disabled={!ready || saving}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
