import { useVirtualizer } from "@tanstack/react-virtual";
import { Pencil, Plus, RotateCw, SquareCode, Table2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  ConfirmDeleteDialog,
  EmptyState,
  IconButton,
  MenuItem,
  Skeleton,
  SkeletonList,
  Text,
  TreeRow,
} from "@/shared/ui";
import { uiPx } from "@/shared/lib/uiScale";
import { ConnectionDialog } from "./ConnectionDialog";
import type { SavedConnection, SchemaTable } from "./dbApi";
import { useDbStore, type SchemaState } from "./dbStore";

/** One line of the tree, flattened so the list can be virtual. */
type Line =
  | { kind: "connection"; key: string; connection: SavedConnection; open: boolean }
  | { kind: "schema"; key: string; connection: string; name: string; count: number; open: boolean }
  | {
      kind: "table";
      key: string;
      connection: string;
      schema: string;
      table: SchemaTable;
      depth: number;
    }
  | { kind: "loading"; key: string; depth: number }
  | { kind: "error"; key: string; connection: string; message: string }
  | { kind: "empty"; key: string; depth: number };

const kindLabel = { sqlite: "SQLite", postgres: "Postgres" } as const;

function linesOf(
  connections: SavedConnection[],
  schemas: Record<string, SchemaState>,
  expanded: Record<string, true>,
): Line[] {
  const lines: Line[] = [];
  for (const connection of connections) {
    const open = Boolean(expanded[`c:${connection.id}`]);
    lines.push({ kind: "connection", key: `c:${connection.id}`, connection, open });
    if (!open) continue;
    const state = schemas[connection.id];
    if (state?.error) {
      lines.push({
        kind: "error",
        key: `e:${connection.id}`,
        connection: connection.id,
        message: state.error,
      });
    }
    if (!state?.schema) {
      if (!state?.error) {
        for (let index = 0; index < 3; index += 1) {
          lines.push({ kind: "loading", key: `l:${connection.id}:${index}`, depth: 1 });
        }
      }
      continue;
    }
    const groups = state.schema.schemas;
    if (!groups.some((group) => group.tables.length)) {
      lines.push({ kind: "empty", key: `n:${connection.id}`, depth: 1 });
      continue;
    }
    // A database with one schema (SQLite's main, a Postgres with only public) lists its tables
    // straight under the connection.
    const flat = groups.length === 1;
    for (const group of groups) {
      const schemaKey = `s:${connection.id}:${group.name}`;
      const schemaOpen = flat || Boolean(expanded[schemaKey]);
      if (!flat) {
        lines.push({
          kind: "schema",
          key: schemaKey,
          connection: connection.id,
          name: group.name,
          count: group.tables.length,
          open: schemaOpen,
        });
      }
      if (!schemaOpen) continue;
      if (!group.tables.length) {
        lines.push({ kind: "empty", key: `n:${schemaKey}`, depth: 2 });
        continue;
      }
      for (const table of group.tables) {
        lines.push({
          kind: "table",
          key: `t:${connection.id}:${group.name}:${table.name}`,
          connection: connection.id,
          schema: group.name,
          table,
          depth: flat ? 1 : 2,
        });
      }
    }
  }
  return lines;
}

/** A row's indent, matching TreeRow's 8px start and 16px per level. */
const indentClass = ["pl-2", "pl-6", "pl-10"] as const;

/** Connections and their schemas, tables and views, with add, edit and remove. */
export function DatabaseSidebar() {
  const connections = useDbStore((state) => state.connections);
  const listError = useDbStore((state) => state.listError);
  const schemas = useDbStore((state) => state.schemas);
  const expanded = useDbStore((state) => state.expanded);
  const selected = useDbStore((state) => state.selected);
  const activeTable = useDbStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTab);
    return tab?.table ? `t:${tab.connectionId}:${tab.table.schema}:${tab.table.name}` : null;
  });
  const [editing, setEditing] = useState<{ connection: SavedConnection | null } | null>(null);
  const [removing, setRemoving] = useState<SavedConnection | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (useDbStore.getState().connections === null) void useDbStore.getState().loadConnections();
  }, []);

  const lines = useMemo(
    () => (connections ? linesOf(connections, schemas, expanded) : []),
    [connections, schemas, expanded],
  );
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => uiPx(32),
    overscan: 10,
    getItemKey: (index) => lines[index]?.key ?? index,
  });

  const store = useDbStore.getState;
  const renderLine = (line: Line): ReactNode => {
    switch (line.kind) {
      case "connection": {
        const { connection } = line;
        return (
          <TreeRow
            label={connection.name}
            detail={kindLabel[connection.kind]}
            chevron
            expanded={line.open}
            selected={selected === connection.id && !activeTable}
            onOpen={() => store().toggleConnection(connection.id)}
            menu={
              <>
                <MenuItem
                  icon={SquareCode}
                  label="New query"
                  onSelect={() => store().newQuery(connection.id)}
                />
                <MenuItem
                  icon={RotateCw}
                  label="Refresh"
                  onSelect={() => void store().loadSchema(connection.id)}
                />
                <MenuItem icon={Pencil} label="Edit" onSelect={() => setEditing({ connection })} />
                <MenuItem
                  icon={Trash2}
                  label="Remove"
                  danger
                  onSelect={() => setRemoving(connection)}
                />
              </>
            }
          />
        );
      }
      case "schema":
        return (
          <TreeRow
            label={line.name}
            depth={1}
            chevron
            expanded={line.open}
            end={
              <Text size="meta" tone="muted">
                {line.count}
              </Text>
            }
            onOpen={() => store().toggleSchema(line.connection, line.name)}
          />
        );
      case "table":
        return (
          <TreeRow
            label={line.table.name}
            depth={line.depth}
            detail={line.table.kind === "view" ? "view" : undefined}
            selected={activeTable === line.key}
            openLabel={`Open ${line.table.name}`}
            onOpen={() => store().openTable(line.connection, line.schema, line.table)}
            menu={
              <MenuItem
                icon={Table2}
                label="Open"
                onSelect={() => store().openTable(line.connection, line.schema, line.table)}
              />
            }
          />
        );
      case "loading":
        return (
          <div
            aria-hidden="true"
            className={`flex h-8 items-center pr-1 ${indentClass[line.depth]}`}
          >
            <Skeleton className="h-3 w-1/2 rounded-sm" />
          </div>
        );
      case "empty":
        return (
          <Text
            bare
            as="div"
            size="meta"
            tone="muted"
            className={`flex h-8 items-center pr-1 ${indentClass[line.depth]}`}
          >
            No tables
          </Text>
        );
      case "error":
        return (
          <Text
            bare
            as="div"
            size="caption"
            tone="danger"
            role="alert"
            className="flex flex-col items-start gap-2 py-2 pr-2 pl-6 break-words"
          >
            <p>{line.message}</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void store().loadSchema(line.connection)}
            >
              Try again
            </Button>
          </Text>
        );
    }
  };

  let body: ReactNode;
  if (connections === null && listError) {
    body = (
      <Text
        bare
        as="div"
        size="caption"
        tone="danger"
        role="alert"
        className="flex flex-col items-start gap-2 px-3 py-2"
      >
        <p>{listError}</p>
        <Button size="sm" variant="secondary" onClick={() => void store().loadConnections()}>
          Try again
        </Button>
      </Text>
    );
  } else if (connections === null) {
    body = <SkeletonList label="Connections" rows={4} className="px-3" />;
  } else if (connections.length === 0) {
    body = (
      <EmptyState
        inline
        title="No databases yet"
        line="Add a SQLite file or a Postgres server."
        action={{
          label: "Add connection",
          icon: Plus,
          onClick: () => setEditing({ connection: null }),
        }}
      />
    );
  } else {
    body = (
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index];
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full px-1"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {line ? renderLine(line) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 flex-none border-b items-center justify-end px-2">
        {connections?.length ? (
          <IconButton label="Add connection" onClick={() => setEditing({ connection: null })}>
            <Plus />
          </IconButton>
        ) : null}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {body}
      </div>
      {editing ? (
        <ConnectionDialog connection={editing.connection} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDeleteDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove "${removing?.name ?? ""}"?`}
        what="The connection and its saved password are removed from this computer. The database itself isn't changed."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (removing) await useDbStore.getState().removeConnection(removing.id);
          setRemoving(null);
        }}
      />
    </div>
  );
}
