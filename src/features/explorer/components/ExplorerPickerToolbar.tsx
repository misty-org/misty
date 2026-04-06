import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { ArrowUp, ChevronLeft, ChevronRight, RefreshCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
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
  }, [pathDraft, props.onNavigate, props.path]);

  return (
    <header className={toolbarStyles.root}>
      <div className={toolbarStyles.navRow}>
        <div className={toolbarStyles.navButtons} role="group" aria-label="Navigation">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Back"
            title="Back"
            className={toolbarStyles.navigationButton}
            disabled={!props.canGoBack}
            onClick={props.onBack}
          >
            <ChevronLeft size={18} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Forward"
            title="Forward"
            className={toolbarStyles.navigationButton}
            disabled={!props.canGoForward}
            onClick={props.onForward}
          >
            <ChevronRight size={18} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Parent folder"
            title="Parent folder"
            className={toolbarStyles.navigationButton}
            disabled={!props.canGoParent}
            onClick={props.onParent}
          >
            <ArrowUp size={18} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Refresh current folder"
            title="Refresh current folder"
            className={toolbarStyles.navigationButton}
            onClick={() => {
              startRefreshSpin();
              props.onRefresh();
            }}
          >
            <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={17} />
          </Button>
        </div>

        <div
          className={cx(toolbarStyles.pathBar, pathEditing && toolbarStyles.pathBarEditing)}
          title={pathEditing ? undefined : "Double-click to edit path"}
          onDoubleClick={beginPathEdit}
        >
          {pathEditing ? (
            <Input
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
          ) : (
            breadcrumbSegments(props.path).map((segment, index) => (
              <Button
                key={`${segment.path}-${index}`}
                className={toolbarStyles.pathButton}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => props.onNavigate(segment.path)}
              >
                {index > 0 ? (
                  <ChevronRight className={toolbarStyles.breadcrumbCaret} size={14} />
                ) : null}
                {segment.label}
              </Button>
            ))
          )}
        </div>

        <label className={`${toolbarStyles.commandSearch} w-[min(260px,28vw)]`}>
          <Search className="shrink-0" size={17} />
          <Input
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
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear search"
              title="Clear search"
              className={toolbarStyles.searchButton}
              onClick={() => {
                props.onQueryChange("");
                searchInputRef.current?.focus();
              }}
            >
              <X size={14} />
            </Button>
          ) : null}
        </label>
      </div>
    </header>
  );
}
