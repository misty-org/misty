import { Play, Plus, RotateCw, Save, Square, SquareCode, Table2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import {
  ActionBar,
  ConfirmDeleteDialog,
  EmptyState,
  IconButton,
  SplitHandle,
  TabStrip,
  Text,
  type ActionBarItem,
} from "@/shared/ui";
import { useDbStore, primaryKeyOf, tableOf, type DbTab } from "./dbStore";
import { ResultsGrid, ResultsSkeleton } from "./ResultsGrid";
import { SaveChangesDialog } from "./SaveChangesDialog";
import { SqlEditor } from "./SqlEditor";

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function duration(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** What the last run brought back, for the end of the tab's bar. */
function summary(tab: DbTab): string {
  const result = tab.result;
  if (!result) return "";
  if (!result.columns.length)
    return `${plural(result.rowsAffected, "row", "rows")} changed in ${duration(result.elapsedMs)}`;
  const rows = result.truncated
    ? `First ${plural(result.rows.length, "row", "rows")}`
    : plural(result.rows.length, "row", "rows");
  return `${rows} in ${duration(result.elapsedMs)}`;
}

/** The rows area: the run's error, its first load, what a statement without rows did, or the grid. */
function Results(props: { tab: DbTab; keyColumns: string[] }) {
  const { tab, keyColumns } = props;
  const schemas = useDbStore((state) => state.schemas);
  const table = useMemo(() => tableOf({ schemas }, tab), [schemas, tab]);
  const store = useDbStore.getState;

  if (tab.error) {
    return (
      <Text wrap size="caption" tone="danger" role="alert" className="px-4 py-3 break-words">
        {tab.error}
      </Text>
    );
  }
  if (!tab.result) {
    if (tab.runId) return <ResultsSkeleton />;
    return <EmptyState title="No results yet" line="Run the query with ⌘↵." />;
  }
  if (!tab.result.columns.length) {
    return (
      <EmptyState
        title={plural(tab.result.rowsAffected, "row changed", "rows changed")}
        line={`It took ${duration(tab.result.elapsedMs)}.`}
      />
    );
  }
  return (
    <ResultsGrid
      result={tab.result}
      edits={tab.edits}
      editable={keyColumns.length > 0 && !tab.runId}
      nullable={(column) => table?.columns.find((item) => item.name === column)?.nullable ?? false}
      onEdit={(row, column, value) => store().editCell(tab.id, row, column, value)}
      onRevert={(row, column) => store().revertCell(tab.id, row, column)}
    />
  );
}

/** One open tab: its bar, then the query's editor over the rows, or a table's rows alone. */
function TabView(props: { tab: DbTab; hidden: boolean }) {
  const { tab } = props;
  const connection = useDbStore((state) =>
    state.connections?.find((item) => item.id === tab.connectionId),
  );
  const schemas = useDbStore((state) => state.schemas);
  const schemaState = schemas[tab.connectionId];
  const keyColumns = useMemo(() => primaryKeyOf({ schemas }, tab), [schemas, tab]);
  const [saving, setSaving] = useState(false);
  const store = useDbStore.getState;
  const running = Boolean(tab.runId);
  const pending = Object.keys(tab.edits).length;

  // Completion and row editing both need the schema, even before the sidebar opens it.
  useEffect(() => {
    if (!schemaState) void store().loadSchema(tab.connectionId);
  }, [schemaState, store, tab.connectionId]);

  const items: ActionBarItem[] = [];
  if (tab.kind === "query") {
    items.push({
      id: "run",
      icon: Play,
      label: "Run",
      shortcut: "⌘↵",
      variant: "primary",
      priority: 3,
      disabled: running || !tab.sql.trim(),
      onSelect: () => void store().run(tab.id),
    });
  } else {
    items.push({
      id: "refresh",
      icon: RotateCw,
      label: "Refresh",
      priority: 2,
      disabled: running || pending > 0,
      onSelect: () => void store().run(tab.id),
    });
  }
  if (running) {
    items.push({
      id: "stop",
      icon: Square,
      label: "Stop",
      priority: 3,
      onSelect: () => store().stop(tab.id),
    });
  }
  if (pending > 0) {
    items.push({
      id: "save",
      icon: Save,
      label: "Save changes",
      variant: "primary",
      priority: 4,
      disabled: running,
      onSelect: () => setSaving(true),
    });
    items.push({
      id: "discard",
      icon: Undo2,
      label: "Discard changes",
      priority: 1,
      disabled: running,
      onSelect: () => store().discardEdits(tab.id),
    });
  }

  const results = <Results tab={tab} keyColumns={keyColumns} />;
  let body: ReactNode;
  if (tab.kind === "query" && connection) {
    body = (
      <PanelGroup direction="vertical" className="min-h-0 min-w-0 flex-1">
        <Panel id="db-query-editor" order={1} defaultSize={40} minSize={15}>
          <div className="flex h-full min-h-0 min-w-0 flex-col">
            <SqlEditor
              value={tab.sql}
              kind={connection.kind}
              schema={schemaState?.schema ?? null}
              onChange={(sql) => store().setSql(tab.id, sql)}
              onRun={() => void store().run(tab.id)}
            />
          </div>
        </Panel>
        <SplitHandle direction="vertical" label="Resize results" seam />
        <Panel id="db-query-results" order={2} minSize={20}>
          <div className="flex h-full min-h-0 min-w-0 flex-col">{results}</div>
        </Panel>
      </PanelGroup>
    );
  } else {
    body = <div className="flex min-h-0 min-w-0 flex-1 flex-col">{results}</div>;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" hidden={props.hidden}>
      <div className="flex h-12 flex-none items-center gap-3 px-3">
        <ActionBar
          label={`${tab.title} actions`}
          items={items}
          width="content"
          className="min-w-0"
        />
        <div className="flex-1" />
        <Text size="meta" tone="muted" className="min-w-0 flex-none">
          {summary(tab)}
        </Text>
      </div>
      {body}
      {saving ? (
        <SaveChangesDialog tab={tab} keyColumns={keyColumns} onClose={() => setSaving(false)} />
      ) : null}
    </div>
  );
}

/**
 * The Databases view's main area: a tab for each open table and query. A table opens on its first
 * rows; a query runs with Run or ⌘↵. Rows of a table with a primary key are edited in the grid
 * and written only after Save changes shows the UPDATEs and the person confirms.
 */
export function DatabaseMain() {
  const tabs = useDbStore((state) => state.tabs);
  const activeTab = useDbStore((state) => state.activeTab);
  const connections = useDbStore((state) => state.connections);
  const selected = useDbStore((state) => state.selected);
  const [closing, setClosing] = useState<DbTab | null>(null);
  const store = useDbStore.getState;

  useEffect(() => {
    if (store().connections === null) void store().loadConnections();
  }, [store]);

  const active = tabs.find((tab) => tab.id === activeTab) ?? null;
  // A new query runs against the open tab's connection, else the one picked in the sidebar.
  const target =
    active?.connectionId ??
    (connections?.some((item) => item.id === selected) ? selected : connections?.[0]?.id) ??
    null;

  const close = (id: string) => {
    const tab = tabs.find((item) => item.id === id);
    if (tab && Object.keys(tab.edits).length) setClosing(tab);
    else store().closeTab(id);
  };

  if (!tabs.length) {
    return (
      <EmptyState
        title="No table open"
        line={
          target
            ? "Open a table from the sidebar, or start a query."
            : "Add a connection in the sidebar to start."
        }
        action={
          target
            ? { label: "New query", icon: SquareCode, onClick: () => store().newQuery(target) }
            : undefined
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabStrip
        label="Open tables and queries"
        tabs={tabs.map((tab) => ({
          id: tab.id,
          label: tab.title,
          icon: tab.kind === "table" ? <Table2 /> : <SquareCode />,
          full: tab.table ? `${tab.table.schema}.${tab.table.name}` : tab.title,
          closeLabel: `Close ${tab.title}`,
        }))}
        active={activeTab}
        onSelect={(id) => store().selectTab(id)}
        onClose={close}
        after={
          target ? (
            <IconButton label="New query" onClick={() => store().newQuery(target)}>
              <Plus />
            </IconButton>
          ) : null
        }
      />
      {tabs.map((tab) => (
        <TabView key={tab.id} tab={tab} hidden={tab.id !== activeTab} />
      ))}
      <ConfirmDeleteDialog
        open={closing !== null}
        onOpenChange={(open) => !open && setClosing(null)}
        title={`Discard the changes to ${closing?.title ?? "this table"}?`}
        what="The edited cells haven't been saved and will be lost."
        confirmLabel="Discard"
        onConfirm={() => {
          if (closing) store().closeTab(closing.id);
          setClosing(null);
        }}
      />
    </div>
  );
}
