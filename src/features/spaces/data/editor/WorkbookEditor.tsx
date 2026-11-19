import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  FindBar,
  Surface,
  Text,
} from "@/shared/ui";
import { ChartBoard } from "../charts/ChartBoard";
import { ChartEditor } from "../charts/ChartEditor";
import { useCharts } from "../charts/useCharts";
import { localEditOrigin } from "../editOrigin";
import { DataGrid } from "../grid/DataGrid";
import { DataToolbar, type ToolbarState } from "../grid/DataToolbar";
import { FilterPopover } from "../grid/FilterPopover";
import { FormulaBar } from "../grid/FormulaBar";
import { addSheetTab, moveSheetTab, setColumnWidth, setFrozenRows } from "../grid/gridEdits";
import { distinctPeople, usePeers } from "../grid/presence";
import { SheetTabs, type WorkbookMode } from "../grid/SheetTabs";
import { cellSelection } from "../grid/selection";
import { columnValues, sheetRow, useDocVersion, useSheetView } from "../grid/sheetView";
import { importKind, importWorkbookFile } from "../import";
import type { WorkbookSession } from "../session";
import { columnLabel } from "../workbook/a1";
import { cellKey } from "../workbook/schema";
import { describeSelection, type SelectionDescription } from "./describeSelection";
import { DataHeader } from "./DataHeader";
import { useGridController } from "./useGridController";
import { useSheetCommands } from "./useSheetCommands";
import { useSheetFind } from "./useSheetFind";
import {
  PeopleHere,
  SheetDialogs,
  WorkbookActions,
  failed,
  saveSheetCsv,
  saveWorkbookXlsx,
} from "./WorkbookActions";

type Filters = Map<string, Map<string, ReadonlySet<string>>>;
const noFilters: ReadonlyMap<string, ReadonlySet<string>> = new Map();

export interface WorkbookEditorProps {
  session: WorkbookSession;
  title: string;
  canEdit: boolean;
  canRename: boolean;
  canDelete: boolean;
  cellLimit: number;
  onBack?: () => void;
  onRename(title: string): Promise<unknown>;
  onDelete(): void;
  onHistory(): void;
  /** Hands the page a way to describe the selection, for the agent's view of it. */
  onDescribe(describe: () => SelectionDescription | null): void;
}

/** The open workbook: its bar, the formula row, the grid or its charts, and the sheet tabs. */
export function WorkbookEditor(props: WorkbookEditorProps) {
  const { session, canEdit } = props;
  const doc = session.doc;
  const engine = session.engine();
  const version = useDocVersion(doc);
  const sheets = useMemo(() => {
    void version;
    return engine.workbookIndex.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name }));
  }, [engine, version]);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const sheetId = sheets.some((sheet) => sheet.id === activeSheet)
    ? activeSheet
    : (sheets[0]?.id ?? null);
  const [mode, setMode] = useState<WorkbookMode>("sheet");
  const [filters, setFilters] = useState<Filters>(() => new Map());
  const sheetFilters = (sheetId && filters.get(sheetId)) || noFilters;
  const view = useSheetView(doc, engine, sheetId, sheetFilters, version);
  const peers = usePeers(session.provider.awareness);
  const people = distinctPeople(peers);
  const charts = useCharts(doc, engine, version);
  const [filterOpen, setFilterOpen] = useState(false);
  const [toolbarChart, setToolbarChart] = useState<string | null>(null);
  const [boardChart, setBoardChart] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const findRef = useRef<() => void>(() => undefined);

  const grid = useGridController({
    session,
    view,
    canEdit,
    cellLimit: props.cellLimit,
    peers,
    onFind: () => findRef.current(),
  });
  const { rect, selection } = grid;

  const find = useSheetFind(view, engine, (cell) =>
    grid.setSelection(cellSelection(cell.row, cell.col)),
  );
  const showFind = find.show;
  useEffect(() => {
    findRef.current = showFind;
  });

  const describe = useCallback(() => describeSelection(engine, view, rect), [engine, view, rect]);
  const onDescribe = props.onDescribe;
  useEffect(() => onDescribe(describe), [onDescribe, describe]);

  const activeCol = selection.anchor.col;
  const activeColId = view?.colIds[activeCol];
  const activeCell =
    view && activeColId
      ? view.cells.get(cellKey(view.rowIds[sheetRow(view, selection.anchor.row)], activeColId))
      : undefined;
  const toolbar: ToolbarState = {
    format: activeCell?.fmt?.num ?? "auto",
    bold: Boolean(activeCell?.fmt?.bold),
    align: activeCell?.fmt?.align ?? null,
    frozen: (view?.frozen ?? 0) > 0,
    filtered: sheetFilters.size > 0,
  };

  const setColumnFilter = (colId: string, allowed: ReadonlySet<string> | null) => {
    if (!sheetId) return;
    setFilters((current) => {
      const next = new Map(current);
      const columns = new Map(next.get(sheetId) ?? []);
      if (allowed) columns.set(colId, allowed);
      else columns.delete(colId);
      next.set(sheetId, columns);
      return next;
    });
  };

  const filterValues = useMemo(
    () =>
      filterOpen && view ? columnValues(engine, view, activeCol) : { values: [], capped: false },
    [filterOpen, view, engine, activeCol],
  );

  const commands = useSheetCommands({
    doc,
    engine,
    view,
    canEdit,
    grid,
    onFilter: () => setFilterOpen(true),
    onChartMade: setToolbarChart,
  });
  const { makeChart, columnMenu, cellMenu } = commands;
  const exportCsv = (id: string) => {
    const sheet = sheets.find((item) => item.id === id);
    if (sheet) saveSheetCsv(doc, props.title, sheet);
  };

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDropping(false);
    const files = [...event.dataTransfer.files].filter((file) => importKind(file));
    if (!files.length || !canEdit) return;
    for (const file of files) {
      try {
        const summary = await importWorkbookFile(doc, file, {
          origin: localEditOrigin,
          cellLimit: props.cellLimit,
        });
        if (summary.sheets[0]) {
          setActiveSheet(summary.sheets[0].id);
          setMode("sheet");
        }
      } catch (error) {
        failed(error, `${file.name} couldn't be imported.`);
      }
    }
  };

  return (
    <Surface
      tone="page"
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(event) => {
        if (!canEdit || ![...event.dataTransfer.items].some((item) => item.kind === "file")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => void onDrop(event)}
    >
      <DataHeader
        title={props.title}
        canRename={props.canRename}
        onBack={props.onBack}
        onRename={props.onRename}
        tools={
          mode === "sheet" && view ? (
            <DataToolbar
              state={toolbar}
              canEdit={canEdit}
              filterOpen={filterOpen}
              onFilterOpen={setFilterOpen}
              filter={
                activeColId ? (
                  <FilterPopover
                    key={activeColId}
                    column={columnLabel(activeCol)}
                    values={filterValues.values}
                    capped={filterValues.capped}
                    allowed={sheetFilters.get(activeColId) ?? null}
                    onChange={(allowed) => setColumnFilter(activeColId, allowed)}
                  />
                ) : null
              }
              onFormat={(num) => grid.format({ num: num === "auto" ? undefined : num })}
              onDecimals={(change) =>
                grid.format({
                  decimals: Math.max(0, Math.min(10, (activeCell?.fmt?.decimals ?? 2) + change)),
                })
              }
              onBold={() => grid.format({ toggle: "bold" })}
              onAlign={(align) => grid.format({ align })}
              onFreeze={() => view && setFrozenRows(doc, view.id, view.frozen > 0 ? 0 : 1)}
              onChart={makeChart}
              chartOpen={Boolean(toolbarChart)}
              onChartClose={() => setToolbarChart(null)}
              chart={
                toolbarChart ? (
                  <ChartEditor
                    doc={doc}
                    engine={engine}
                    chartId={toolbarChart}
                    version={version}
                    canEdit={canEdit}
                  />
                ) : null
              }
            />
          ) : null
        }
        end={
          <>
            <PeopleHere people={people} />
            <WorkbookActions
              canDelete={props.canDelete}
              onExportXlsx={() => void saveWorkbookXlsx(doc, props.title)}
              onExportCsv={sheetId ? () => exportCsv(sheetId) : undefined}
              onHistory={props.onHistory}
              onDelete={props.onDelete}
            />
          </>
        }
      />
      {mode === "sheet" && view ? (
        <>
          {find.open ? (
            <FindBar
              {...find.bar}
              onClose={() => {
                find.close();
                grid.focusGrid();
              }}
            />
          ) : null}
          <FormulaBar
            name={grid.name}
            text={grid.barText}
            canEdit={canEdit}
            onStart={grid.startBarEdit}
            onChange={grid.editText}
            onCommit={grid.commit}
            onCancel={grid.cancel}
          />
          <ContextMenu>
            <ContextMenuTrigger asChild disabled={!canEdit}>
              <div className="flex min-h-0 flex-1 flex-col">
                <DataGrid
                  view={view}
                  engine={engine}
                  selection={selection}
                  editing={grid.editing}
                  peers={grid.peers}
                  canEdit={canEdit}
                  filteredCols={new Set(sheetFilters.keys())}
                  gridRef={grid.gridRef}
                  columnMenu={columnMenu}
                  onSelect={grid.setSelection}
                  onEdit={(position, editMode) => grid.startEdit(position, editMode)}
                  onEditText={grid.editText}
                  onCommit={grid.commit}
                  onCancel={grid.cancel}
                  onKeyDown={grid.onKeyDown}
                  onCopy={grid.onCopy}
                  onCut={grid.onCut}
                  onPaste={grid.onPaste}
                  onFill={grid.fill}
                  onResizeColumn={(col, width) =>
                    view.colIds[col] && setColumnWidth(doc, view.id, view.colIds[col], width)
                  }
                  onSelectColumn={grid.selectColumn}
                  onSelectRow={grid.selectRow}
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent width="md">{cellMenu}</ContextMenuContent>
          </ContextMenu>
        </>
      ) : mode === "sheet" ? (
        <div className="min-h-0 flex-1" />
      ) : (
        <ChartBoard
          doc={doc}
          engine={engine}
          version={version}
          canEdit={canEdit}
          kind={mode}
          entries={mode === "charts" ? charts.charts : charts.dashboard}
          editing={boardChart}
          onEditing={setBoardChart}
        />
      )}
      <SheetTabs
        sheets={sheets}
        active={sheetId}
        mode={mode}
        canEdit={canEdit}
        onSelect={(id) => {
          setActiveSheet(id);
          setMode("sheet");
        }}
        onAdd={() => {
          try {
            setActiveSheet(addSheetTab(doc));
            setMode("sheet");
          } catch (error) {
            failed(error, "A sheet couldn't be added.");
          }
        }}
        onRename={setRenaming}
        onDelete={setDeleting}
        onReorder={(id, index) => moveSheetTab(doc, id, index)}
        onExportCsv={exportCsv}
        onMode={setMode}
      />
      {dropping ? (
        <Surface
          tone="drop"
          edge="dashed"
          radius="xl"
          className="pointer-events-none absolute inset-4 z-40 flex items-center justify-center"
        >
          <Text size="page" tone="bright">
            Drop to add its sheets
          </Text>
        </Surface>
      ) : null}
      <SheetDialogs
        doc={doc}
        sheets={sheets}
        renaming={renaming}
        deleting={deleting}
        onDone={() => {
          setRenaming(null);
          setDeleting(null);
        }}
      />
    </Surface>
  );
}
