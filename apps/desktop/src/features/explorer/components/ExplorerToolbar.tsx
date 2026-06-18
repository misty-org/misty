import { ChevronLeft, ChevronRight, Grid2X2, List, MoreHorizontal, Plus, RefreshCcw, Scissors, Search, Upload } from "lucide-react";
import { breadcrumbSegments } from "../utils/fileFormat";
import type { ExplorerViewMode } from "../state/useExplorerStore";

interface ExplorerToolbarProps {
  path: string;
  commandQuery: string;
  viewMode: ExplorerViewMode;
  showHidden: boolean;
  onNavigate: (path: string) => void;
  onParent: () => void;
  onRefresh: () => void;
  onCommandQuery: (value: string) => void;
  onViewMode: (mode: ExplorerViewMode) => void;
  onToggleHidden: () => void;
}

export function ExplorerToolbar(props: ExplorerToolbarProps) {
  return (
    <header className="explorer-toolbar">
      <div className="explorer-nav-row">
        <button><ChevronLeft size={18} /></button>
        <button><ChevronRight size={18} /></button>
        <button onClick={props.onParent}>↑</button>
        <button onClick={props.onRefresh}><RefreshCcw size={18} /></button>
        <div className="path-bar">
          {breadcrumbSegments(props.path).map((segment, index) => (
            <button key={`${segment.path}-${index}`} onClick={() => props.onNavigate(segment.path)}>
              {index > 0 ? <span>&gt;</span> : null}
              {segment.label}
            </button>
          ))}
        </div>
        <label className="command-search">
          <Search size={18} />
          <input
            value={props.commandQuery}
            placeholder="Search or run command"
            onChange={(event) => props.onCommandQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="explorer-action-row">
        <button className="new-button">
          <Plus size={18} />
          New
          <span>⌄</span>
        </button>
        <button><Scissors size={18} /></button>
        <button><Upload size={18} /></button>
        <button onClick={props.onToggleHidden} className={props.showHidden ? "selected" : ""}>Hidden</button>
        <div className="view-toggle">
          <button className={props.viewMode === "grid" ? "selected" : ""} onClick={() => props.onViewMode("grid")}>
            <Grid2X2 size={18} />
          </button>
          <button className={props.viewMode === "list" ? "selected" : ""} onClick={() => props.onViewMode("list")}>
            <List size={18} />
          </button>
        </div>
        <button><MoreHorizontal size={20} /></button>
      </div>
    </header>
  );
}
