import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  CircleX,
  GitBranch,
  Palette,
  RadioTower,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { create } from "zustand";
import { editorThemes } from "@/shared/lib/codemirror/editorThemes";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuRadioGroup,
  MenuRadioItem,
  Text,
  Tooltip,
} from "@/shared/ui";
import { fileName, useFilesStore } from "../context-panel/files/filesStore";
import { LineCounts } from "../context-panel/git/LineCounts";
import { useGitStore } from "../context-panel/git/store";
import { updateCodePageLayout, useCodePageLayout } from "./codePageStore";
import { useCodeStatus } from "./codeStatus";
import { useEditorTheme } from "./editorAppearance";
import { LivePresence } from "./live";
import { LspStatusItem } from "./lsp";

/** What one Code page works in, for the window's bottom bar while that page is focused. */
interface CodeBarPage {
  root: string;
  /** The joined live session's name; null outside one. */
  sessionName: string | null;
}

/** Each mounted Code page's folder and live session, by workspace view id. */
export const useCodeBar = create<{ byView: Record<string, CodeBarPage> }>(() => ({ byView: {} }));

/** Tells the bottom bar what the Code page in `viewId` works in, while it is mounted. */
export function useShareCodeBar(viewId: string | null, root: string, sessionName: string | null) {
  useEffect(() => {
    if (!viewId) return;
    useCodeBar.setState((state) => ({
      byView: { ...state.byView, [viewId]: { root, sessionName } },
    }));
  }, [viewId, root, sessionName]);
  useEffect(() => {
    if (!viewId) return;
    return () =>
      useCodeBar.setState((state) => {
        const { [viewId]: _gone, ...rest } = state.byView;
        return { byView: rest };
      });
  }, [viewId]);
}

/** The focused Code page, as each Code item of the bar is given it. */
export interface FocusedCodePage {
  viewId: string;
}

const usePage = (viewId: string) => useCodeBar((state) => state.byView[viewId]);

function useActiveStatus() {
  const active = useFilesStore((state) => state.activeFilePath);
  const status = useCodeStatus((state) => (active ? state.byPath[active] : undefined));
  return { active, status };
}

/** Plain bar text in the bar's own size, beside its buttons. */
function BarText({ children }: { children: ReactNode }) {
  return (
    <Text
      bare
      size="control"
      tone="muted"
      className="flex h-8 flex-none items-center gap-1.5 whitespace-nowrap px-2"
    >
      {children}
    </Text>
  );
}

/** Vim's mode while vim is on, in sentence case. */
export function CodeVimStatus(_: FocusedCodePage) {
  const { status } = useActiveStatus();
  if (!status?.vimMode) return null;
  const mode = status.vimMode.charAt(0).toUpperCase() + status.vimMode.slice(1);
  return (
    <Text
      bare
      size="control"
      className="flex h-8 flex-none items-center whitespace-nowrap px-2"
      aria-label={`Vim mode: ${mode}`}
    >
      {mode}
    </Text>
  );
}

/** The project's branch, with its uncommitted lines. Opens Changes. */
export function CodeBranchStatus({ viewId }: FocusedCodePage) {
  const root = usePage(viewId)?.root ?? "";
  const status = useGitStore((state) => (root ? state.statusByWorkspace[root] : undefined));
  useEffect(() => {
    if (root) void useGitStore.getState().refresh(root);
  }, [root]);
  if (!status?.branch) return null;
  return (
    <Button
      variant="quiet"
      icon={GitBranch}
      onClick={() => updateCodePageLayout({ activity: "changes", sidebarOpen: true })}
    >
      <span className="flex items-center gap-1.5">
        {status.branch}
        <LineCounts git={status} />
      </span>
    </Button>
  );
}

/** The live session the page is in, with the others in it. Opens Live. */
export function CodeLiveStatus({ viewId }: FocusedCodePage) {
  const sessionName = usePage(viewId)?.sessionName;
  if (!sessionName) return null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Button
        variant="quiet"
        icon={RadioTower}
        onClick={() => updateCodePageLayout({ activity: "live", sidebarOpen: true })}
      >
        {sessionName}
      </Button>
      <LivePresence />
    </span>
  );
}

/** The open file's errors and warnings, while it has any. */
export function CodeProblemsStatus(_: FocusedCodePage) {
  const { status } = useActiveStatus();
  const errors = status?.errors ?? 0;
  const warnings = status?.warnings ?? 0;
  if (!errors && !warnings) return null;
  return (
    <span className="flex flex-none items-center" role="status">
      {errors ? (
        <Text
          bare
          size="control"
          tone="removed"
          className="flex h-8 items-center gap-1.5 px-2"
          aria-label={`${errors} ${errors === 1 ? "error" : "errors"}`}
        >
          <CircleX aria-hidden />
          {errors}
        </Text>
      ) : null}
      {warnings ? (
        <Text
          bare
          size="control"
          tone="changed"
          className="flex h-8 items-center gap-1.5 px-2"
          aria-label={`${warnings} ${warnings === 1 ? "warning" : "warnings"}`}
        >
          <TriangleAlert aria-hidden />
          {warnings}
        </Text>
      ) : null}
    </span>
  );
}

/** Where the cursor is in the open file. */
export function CodeCursorStatus(_: FocusedCodePage) {
  const { active, status } = useActiveStatus();
  if (!active || !status) return null;
  return <BarText>{`Ln ${status.line}, Col ${status.column}`}</BarText>;
}

/** The open file's language. */
export function CodeLanguageStatus(_: FocusedCodePage) {
  const active = useFilesStore((state) => state.activeFilePath);
  const language = active
    ? LanguageDescription.matchFilename(languages, fileName(active))?.name
    : undefined;
  return language ? <BarText>{language}</BarText> : null;
}

/** The open file's language server: installing, starting, busy, its name, or why it failed. */
export function CodeServerStatus({ viewId }: FocusedCodePage) {
  const root = usePage(viewId)?.root ?? "";
  const active = useFilesStore((state) => state.activeFilePath);
  return (
    <span className="flex h-8 min-w-0 items-center px-2">
      <LspStatusItem path={active} root={root} />
    </span>
  );
}

/** The editor's theme, switched in place; Settings › Appearance › Editor has it too. */
export function CodeThemeStatus(_: FocusedCodePage) {
  const theme = useEditorTheme((state) => state.value);
  return (
    <DropdownMenu>
      <Tooltip content="Editor theme">
        <DropdownMenuTrigger asChild>
          <Button variant="quiet" icon={Palette}>
            {editorThemes.find((entry) => entry.value === theme)?.label ?? "Misty"}
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <MenuRadioGroup value={theme} onValueChange={(next) => useEditorTheme.getState().set(next)}>
          {editorThemes.map((entry) => (
            <MenuRadioItem key={entry.value} value={entry.value} label={entry.label} />
          ))}
        </MenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shows or hides the Code page's terminal. */
export function CodeTerminalButton(_: FocusedCodePage) {
  const terminalOpen = useCodePageLayout((state) => state.value.terminalOpen);
  return (
    <IconButton
      label={terminalOpen ? "Hide the terminal" : "Show the terminal"}
      shortcut="⌃`"
      aria-pressed={terminalOpen}
      onClick={() => updateCodePageLayout({ terminalOpen: !terminalOpen })}
    >
      <SquareTerminal />
    </IconButton>
  );
}
