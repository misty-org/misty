import { FolderOpen } from "lucide-react";
import { IconButton, Surface, Text } from "@/shared/ui";
import { mcpApi } from "./api";
import { copy, engineLabel, sourceLabel } from "./copy";
import type { McpEngineInventory, McpSourceInfo } from "./types";

/** Where Misty looks for the engine's config. Missing files still show, so an empty list never
 *  reads as "this CLI has no MCP". */
export function McpSourceHint({
  sources,
  workspacePath = null,
}: {
  sources: McpSourceInfo[];
  workspacePath?: string | null;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="grid gap-1 pb-3">
      <Text bare tone="default" weight="medium" className="text-sm">
        {copy.sourcesTitle}
      </Text>
      {sources.map((info) => (
        <Text
          bare
          key={`${info.source}:${info.path}`}
          tone="muted"
          className="flex min-w-0 items-baseline gap-2 text-xs"
        >
          <span className="shrink-0">{sourceLabel(info.source)}</span>
          <span className="min-w-0 break-all">{info.path}</span>
          {!info.exists ? <span className="shrink-0">({copy.sourceMissing})</span> : null}
          <IconButton
            label={copy.reveal}
            className="self-center"
            onClick={() => void mcpApi.reveal(info.path, workspacePath).catch(() => undefined)}
          >
            <FolderOpen aria-hidden />
          </IconButton>
        </Text>
      ))}
    </div>
  );
}

export function EngineNotices({ engine }: { engine: McpEngineInventory }) {
  const name = engineLabel(engine.id);
  const notes: string[] = [];
  if (engine.support === "none") notes.push(copy.supportNone(name));
  if (engine.support === "plugin") notes.push(copy.supportPlugin(name));
  if (engine.support !== "none" && !engine.available) notes.push(copy.notInstalled);
  if (notes.length === 0 && engine.config.errors.length === 0) return null;
  return (
    <div className="grid gap-2">
      {notes.map((note) => (
        <Surface as="p" key={note} tone="well" radius="lg" className="px-3 py-2 text-sm">
          <Text bare tone="default">
            {note}
          </Text>
        </Surface>
      ))}
      {engine.config.errors.map((error) => (
        <Surface
          as="p"
          key={`${error.source}:${error.path}`}
          role="alert"
          tone="none"
          edge="hairline"
          radius="lg"
          className="px-3 py-2 text-sm"
        >
          <Text bare tone="bright">
            {error.message}
          </Text>
          <Text bare tone="muted" className="ml-2 break-all text-xs">
            {error.path}
          </Text>
        </Surface>
      ))}
    </div>
  );
}
