import { FolderOpen } from "lucide-react";
import { MenuItem, notify, Shelf, ShelfItem, Surface, Text } from "@misty/ui";
import { mcpApi } from "./api";
import { copy, engineLabel, sourceLabel } from "./copy";
import type { McpEngineInventory, McpSourceInfo } from "./types";

/** Where Misty looks for the engine's config, a shelf of its files. Missing files still show, so
 *  an empty list never reads as "this CLI has no MCP". */
export function McpSourceHint({
  sources,
  workspacePath = null,
}: {
  sources: McpSourceInfo[];
  workspacePath?: string | null;
}) {
  if (sources.length === 0) return null;
  return (
    <Shelf title={copy.sourcesTitle}>
      {sources.map((info) => (
        <ShelfItem
          key={`${info.source}:${info.path}`}
          title={sourceLabel(info.source)}
          line={info.exists ? info.path : `${copy.sourceMissing}, ${info.path}`}
          menu={
            <MenuItem
              icon={FolderOpen}
              label={copy.reveal}
              onSelect={() =>
                void mcpApi
                  .reveal(info.path, workspacePath)
                  .catch((error: unknown) =>
                    notify({
                      message: error instanceof Error ? error.message : String(error),
                      tone: "error",
                    }),
                  )
              }
            />
          }
        />
      ))}
    </Shelf>
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
        <Surface as="p" key={note} tone="well" radius="lg" className="m-0 px-3 py-2">
          <Text tone="default" wrap>
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
          className="m-0 grid gap-0.5 px-3 py-2"
        >
          <Text tone="bright" wrap>
            {error.message}
          </Text>
          <Text size="meta" tone="muted">
            {error.path}
          </Text>
        </Surface>
      ))}
    </div>
  );
}
