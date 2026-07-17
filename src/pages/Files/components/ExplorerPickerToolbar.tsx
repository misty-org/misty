import { ArrowUp, ChevronLeft, ChevronRight, RefreshCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMinimumSpin } from "../../../shared/hooks/useMinimumSpin";
import { breadcrumbSegments } from "../utils/fileFormat";
import { cx, toolbarStyles } from "./ExplorerToolbarSupport";

interface ExplorerPickerToolbarProps {
  path: string;
  query: string;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoParent: boolean;
  onBack: () => void;
  onForward: () => void;
  onParent: () => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onQueryChange: (query: string) => void;
}

export function ExplorerPickerToolbar(props: ExplorerPickerToolbarProps) {
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState(props.path);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(false);

  useEffect(() => {
    if (!pathEditing) setPathDraft(props.path);
  }, [pathEditing, props.path]);

  useLayoutEffect(() => {
    if (!pathEditing) return;
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [pathEditing]);

  const beginPathEdit = useCallback(() => {
    setPathDraft(props.path);
    setPathEditing(true);
  }, [props.path]);

  const cancelPathEdit = useCallback(() => {
    setPathEditing(false);
    setPathDraft(props.path);
  }, [props.path]);

  const submitPathEdit = useCallback(() => {
    const target = pathDraft.trim();
    setPathEditing(false);
    setPathDraft(props.path);
    if (target) props.onNavigate(target);
  }, [pathDraft, props]);

  return (
    <header className={toolbarStyles.root}>
      <div className={toolbarStyles.navRow}>
        <div className={toolbarStyles.navButtons}>
          <button className={toolbarStyles.toolbarButton} type="button" title="Back" aria-label="Back" disabled={!props.canGoBack} onClick={props.onBack}><ChevronLeft size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Forward" aria-label="Forward" disabled={!props.canGoForward} onClick={props.onForward}><ChevronRight size={18} /></button>
          <button className={toolbarStyles.toolbarButton} type="button" title="Parent folder" aria-label="Parent folder" disabled={!props.canGoParent} onClick={props.onParent}><ArrowUp size={18} /></button>
          <button
            className={toolbarStyles.toolbarButton}
            type="button"
            title="Refresh current folder"
            aria-label="Refresh current folder"
            onClick={() => {
              startRefreshSpin();
              props.onRefresh();
            }}
          >
            <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={17} />
          </button>
        </div>

        <div
          className={cx(toolbarStyles.pathBar, pathEditing && toolbarStyles.pathBarEditing)}
          title={pathEditing ? undefined : "Double-click to edit path"}
          onDoubleClick={beginPathEdit}
        >
          {pathEditing ? (
            <input
              ref={pathInputRef}
              className={toolbarStyles.pathInput}
              value={pathDraft}
              placeholder="Enter file path"
              spellCheck={false}
              onChange={(event) => setPathDraft(event.target.value)}
              onBlur={cancelPathEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitPathEdit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelPathEdit();
                }
              }}
            />
          ) : breadcrumbSegments(props.path).map((segment, index) => (
            <button key={`${segment.path}-${index}`} className={toolbarStyles.pathButton} type="button" onClick={() => props.onNavigate(segment.path)}>
              {index > 0 ? <ChevronRight className={toolbarStyles.breadcrumbCaret} size={14} /> : null}
              {segment.label}
            </button>
          ))}
        </div>

        <label className={`${toolbarStyles.commandSearch} w-[min(260px,28vw)]`}>
          <Search className="shrink-0" size={17} />
          <input
            ref={searchInputRef}
            className={toolbarStyles.commandInput}
            type="search"
            value={props.query}
            placeholder="Search this folder"
            aria-label="Search this folder"
            spellCheck={false}
            onChange={(event) => props.onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && props.query) {
                event.preventDefault();
                event.stopPropagation();
                props.onQueryChange("");
              }
            }}
          />
          {props.query ? (
            <button
              className={toolbarStyles.searchButton}
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => {
                props.onQueryChange("");
                searchInputRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          ) : null}
        </label>
      </div>
    </header>
  );
}
