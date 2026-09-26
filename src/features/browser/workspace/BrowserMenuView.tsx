import { browserToolbarStyles } from "./browserToolbarStyles";
import { useEffect, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  menuShortcutClass,
} from "@/shared/ui";
import { ShortcutText } from "@/features/shortcuts";
import {
  AppWindow,
  Bookmark,
  BookmarkCheck,
  BookmarkPlus,
  CircleHelp,
  Code2,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  FileDown,
  Library,
  MoreVertical,
  Plus,
  Printer,
  Puzzle,
  QrCode,
  RotateCcw,
  Search,
  Settings2,
  Share2,
  VenetianMask,
  Wrench,
} from "lucide-react";
import { BrowserZoomControls, useBrowserZoom } from "./BrowserZoomControls";
import { useBrowserOverlay } from "./useBrowserOverlay";
import type { BrowserPageCommands } from "./useBrowserPageCommands";
import { BrowserHistoryMenu } from "./BrowserHistoryMenu";
import "../../../shared/toolAssets/websiteChrome.css";

export interface BrowserMenuViewProps {
  iconButtonClass: string;
  setOverlay: (reason: string, active: boolean) => Promise<void>;
  zoomId?: string;
  setZoom?: (factor: number) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  reportError: (error: unknown) => void;
  url: string;
  commands?: BrowserPageCommands;
  active?: boolean;
  canOpenExternal?: boolean;
  label?: string;
  overlayReason?: string;
}

function Item(props: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onSelect?: () => void;
}) {
  return (
    <DropdownMenuItem disabled={!props.onSelect} onSelect={() => props.onSelect?.()}>
      {props.icon}
      <span className="flex-1">{props.label}</span>
      {props.shortcut ? (
        <ShortcutText commandId={props.shortcut} className={menuShortcutClass} />
      ) : null}
    </DropdownMenuItem>
  );
}

/** The browser's More menu: tabs, library pages, zoom and page tools. */
export function BrowserMenuView(props: BrowserMenuViewProps) {
  const zoom = useBrowserZoom(props.zoomId, props.setZoom ?? (async () => {}), props.reportError);
  const overlay = useBrowserOverlay(props.overlayReason ?? "menu", props.setOverlay);
  useEffect(() => {
    if (props.active === false) overlay.onOpenChange(false);
  }, [props.active, overlay.onOpenChange]);
  const commands = props.commands;
  const canOpenExternal = props.canOpenExternal ?? /^https?:\/\//i.test(props.url);
  return (
    <DropdownMenu open={overlay.open} onOpenChange={overlay.onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={props.iconButtonClass}
          aria-label={props.label ?? "Browser menu"}
          title="More"
        >
          <MoreVertical {...browserToolbarStyles.icon} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="website-header-menu max-h-[calc(100dvh-80px)] w-64 overflow-y-auto"
      >
        {commands ? (
          <>
            <Item icon={<Plus />} label="New tab" shortcut="workspace.new_tab" onSelect={commands.newTab} />
            <Item
              icon={<AppWindow />}
              label="New window"
              shortcut="workspace.new_virtual_window"
              onSelect={commands.newWindow}
            />
            <Item
              icon={<VenetianMask />}
              label="New private tab"
              shortcut="browser.new_private_tab"
              onSelect={commands.newPrivateTab}
            />
            <Item
              icon={<RotateCcw />}
              label="Reopen closed tab"
              shortcut="workspace.reopen_tab"
              onSelect={commands.reopenTab}
            />
            <DropdownMenuSeparator />
            <BrowserHistoryMenu
              openHistory={() => commands.openPage("history")}
              reopenClosedTab={commands.reopenClosedTab}
              clearBrowsingData={commands.clearBrowsingData}
            />
            <Item
              icon={<Download />}
              label="Downloads"
              shortcut="browser.downloads"
              onSelect={() => commands.openPage("downloads")}
            />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Bookmark />
                Bookmarks
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                <Item
                  icon={<BookmarkPlus />}
                  label="Bookmark this page"
                  shortcut="browser.bookmark"
                  onSelect={commands.bookmark}
                />
                <Item
                  icon={<BookmarkCheck />}
                  label="Bookmark all tabs"
                  onSelect={commands.bookmarkAllTabs}
                />
                <Item
                  icon={<Library />}
                  label="Bookmark manager"
                  onSelect={() => commands.openPage("bookmarks")}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <BrowserZoomControls zoom={zoom} menu />
        <DropdownMenuSeparator />
        {commands ? (
          <>
            <Item icon={<Search />} label="Find…" shortcut="browser.find" onSelect={commands.find} />
            <Item icon={<Printer />} label="Print…" shortcut="browser.print" onSelect={commands.print} />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Share2 />
                Share
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <Item icon={<Copy />} label="Copy link" onSelect={commands.copyLink} />
                <Item icon={<QrCode />} label="QR code…" onSelect={commands.qrCode} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Wrench />
                More tools
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                <Item icon={<FileDown />} label="Save page as…" onSelect={commands.savePage} />
                <Item
                  icon={<Eraser />}
                  label="Clear browsing data…"
                  shortcut="browser.clear_data"
                  onSelect={commands.clearBrowsingData}
                />
                <DropdownMenuSeparator />
                <Item
                  icon={<Code2 />}
                  label="Developer tools"
                  shortcut="browser.developer_tools"
                  onSelect={commands.developerTools}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <Item
          icon={<ExternalLink />}
          label="Open in default browser"
          onSelect={
            canOpenExternal
              ? () => void props.openExternal(props.url).catch(props.reportError)
              : undefined
          }
        />
        {commands ? (
          <>
            <Item icon={<Puzzle />} label="Extensions" onSelect={() => commands.openPage("extensions")} />
            <Item icon={<CircleHelp />} label="Help" onSelect={commands.help} />
            <Item icon={<Settings2 />} label="Settings" onSelect={() => commands.openPage("settings")} />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
