import { useEffect, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  MenuItem,
  MenuSubmenu,
  MenuTrigger,
  toolbarIconProps,
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

export interface BrowserMenuViewProps {
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

/** A browser command row; rows without a handler render disabled. */
function Item(props: { icon: ReactNode; label: string; shortcut?: string; onSelect?: () => void }) {
  return (
    <MenuItem
      icon={props.icon}
      label={props.label}
      shortcut={props.shortcut ? <ShortcutText commandId={props.shortcut} /> : undefined}
      disabled={!props.onSelect}
      onSelect={() => props.onSelect?.()}
    />
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
      <MenuTrigger
        iconOnly
        label={props.label ?? "Browser menu"}
        title="More"
        icon={<MoreVertical {...toolbarIconProps} />}
      />
      <DropdownMenuContent
        align="end"
        width="lg"
        className="max-h-[calc(100dvh-80px)]"
        data-browser-menu
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
            <MenuSubmenu icon={<Bookmark />} label="Bookmarks" width="lg">
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
              </MenuSubmenu>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <BrowserZoomControls zoom={zoom} menu />
        <DropdownMenuSeparator />
        {commands ? (
          <>
            <Item icon={<Search />} label="Find…" shortcut="browser.find" onSelect={commands.find} />
            <Item icon={<Printer />} label="Print…" shortcut="browser.print" onSelect={commands.print} />
            <MenuSubmenu icon={<Share2 />} label="Share" width="md">
                <Item icon={<Copy />} label="Copy link" onSelect={commands.copyLink} />
                <Item icon={<QrCode />} label="QR code…" onSelect={commands.qrCode} />
              </MenuSubmenu>
            <MenuSubmenu icon={<Wrench />} label="More tools" width="lg">
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
              </MenuSubmenu>
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
