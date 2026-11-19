import { ChartColumn, FileDown, LayoutDashboard, Pencil, Plus, Sheet, Trash2 } from "lucide-react";
import {
  ChoiceGroup,
  IconButton,
  MenuItem,
  MenuSeparator,
  TabStrip,
  type TabStripTab,
} from "@/shared/ui";

export type WorkbookMode = "sheet" | "charts" | "dashboard";

/**
 * The tabs along the workbook's bottom: its sheets (add, rename, drag to reorder, delete from a
 * right-click), and at the far end the switch between the sheet, its charts and the dashboard.
 */
export function SheetTabs(props: {
  sheets: ReadonlyArray<{ id: string; name: string }>;
  active: string | null;
  mode: WorkbookMode;
  canEdit: boolean;
  onSelect(sheetId: string): void;
  onAdd(): void;
  onRename(sheetId: string): void;
  onDelete(sheetId: string): void;
  onReorder(sheetId: string, index: number): void;
  onExportCsv(sheetId: string): void;
  onMode(mode: WorkbookMode): void;
}) {
  const tabs: TabStripTab[] = props.sheets.map((sheet) => ({
    id: sheet.id,
    label: sheet.name,
    menu: (
      <>
        {props.canEdit ? (
          <MenuItem icon={Pencil} label="Rename" onSelect={() => props.onRename(sheet.id)} />
        ) : null}
        <MenuItem
          icon={FileDown}
          label="Export as CSV"
          onSelect={() => props.onExportCsv(sheet.id)}
        />
        {props.canEdit && props.sheets.length > 1 ? (
          <>
            <MenuSeparator />
            <MenuItem
              icon={Trash2}
              label="Delete sheet"
              danger
              onSelect={() => props.onDelete(sheet.id)}
            />
          </>
        ) : null}
      </>
    ),
  }));
  return (
    <div data-tour="workbook-sheets" className="contents">
      <TabStrip
        label="Sheets"
        tabs={tabs}
        active={props.mode === "sheet" ? props.active : null}
        onSelect={props.onSelect}
        onReorder={props.canEdit ? props.onReorder : undefined}
        after={
          props.canEdit ? (
            <IconButton label="New sheet" onClick={props.onAdd}>
              <Plus />
            </IconButton>
          ) : undefined
        }
        end={
          <ChoiceGroup
            label="Show"
            value={props.mode}
            onChange={props.onMode}
            options={[
              { value: "sheet", label: "Sheet", icon: Sheet },
              { value: "charts", label: "Charts", icon: ChartColumn },
              { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
            ]}
          />
        }
      />
    </div>
  );
}
