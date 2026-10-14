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
  CircleHelp,
  Code2,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  FileDown,
  MoreVertical,
  SlidersHorizontal,
  BookOpenText,
  Languages,
  PictureInPicture2,
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
import { pictureInPictureSupported } from "@/features/webviews/pictureInPictureSettings";
import { SiteAppsMenu } from "./SiteAppsMenu";

export interface BrowserMenuViewProps {
  setOverlay: (reason: string, active: boolean) => Promise<void>;
  zoomId?: string;
  /** The site's saved zoom percent; omitted for private tabs. */
  zoomPercent?: number;
  setZoom?: (factor: number) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  reportError: (error: unknown) => void;
  url: string;
  commands?: BrowserPageCommands;
  active?: boolean;
  canOpenExternal?: boolean;
  label?: string;
  overlayReason?: string;
  /** Favorites and Bookmarks, as panels beside the History row. */
  library?: ReactNode;
  /** Rows closing the menu, under Settings: sync and the profile. */
  account?: ReactNode;
  /** Rows above the browser's own, such as the sidebar's bookmark, Misty and extensions. */
  lead?: ReactNode;
  /** The trigger is a tools icon, as in the vertical-tabs sidebar's address field. */
  toolsIcon?: boolean;
  /** Page tools that used to sit in the toolbar; they lead the More tools submenu. */
  tools?: ReactNode;
  /** Installing and opening site apps; omitted where the menu has no page. */
  app?: { title: string; bookmarkId?: string; installable: boolean };
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
  const zoom = useBrowserZoom(
    props.zoomId,
    props.setZoom ?? (async () => {}),
    props.reportError,
    props.zoomPercent,
  );
  const overlay = useBrowserOverlay(props.overlayReason ?? "menu", props.setOverlay);
  const setOverlayOpen = overlay.onOpenChange;
  useEffect(() => {
    if (props.active === false) setOverlayOpen(false);
  }, [props.active, setOverlayOpen]);
  const commands = props.commands;
  const canOpenExternal = props.canOpenExternal ?? /^https?:\/\//i.test(props.url);
  return (
    <DropdownMenu open={overlay.open} onOpenChange={overlay.onOpenChange} modal={false}>
      <MenuTrigger
        iconOnly
        label={props.label ?? "Browser menu"}
        title="More"
        icon={
          props.toolsIcon ? (
            <SlidersHorizontal {...toolbarIconProps} />
          ) : (
            <MoreVertical {...toolbarIconProps} />
          )
        }
      />
      <DropdownMenuContent
        align="end"
        width="lg"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)]"
        data-browser-menu
      >
        {props.lead}
        {commands ? (
          <>
            <Item
              icon={<Plus />}
              label="New tab"
              shortcut="search.toggle"
              onSelect={commands.newTab}
            />
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
              onSelect={commands.newPrivateView}
            />
            <Item
              icon={<RotateCcw />}
              label="Reopen closed tab"
              shortcut="workspace.reopen_tab"
              onSelect={commands.reopenView}
            />
            <DropdownMenuSeparator />
            <BrowserHistoryMenu
              openHistory={() => commands.openPage("history")}
              reopenClosedView={commands.reopenClosedTab}
              clearBrowsingData={commands.clearBrowsingData}
            />
            {props.library}
            <Item
              icon={<Download />}
              label="Downloads"
              shortcut="browser.downloads"
              onSelect={() => commands.openPage("downloads")}
            />
            {props.app ? <SiteAppsMenu {...props.app} url={props.url} /> : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <BrowserZoomControls zoom={zoom} menu />
        <DropdownMenuSeparator />
        {commands ? (
          <>
            <Item
              icon={<Search />}
              label="Find…"
              shortcut="browser.find"
              onSelect={commands.find}
            />
            <Item
              icon={<Printer />}
              label="Print…"
              shortcut="browser.print"
              onSelect={commands.print}
            />
            <Item icon={<Languages />} label="Translate page" onSelect={commands.translate} />
            <Item
              icon={<BookOpenText />}
              label="Reader view"
              shortcut="browser.reader_mode"
              onSelect={commands.readerMode}
            />
            {pictureInPictureSupported() && (
              <Item
                icon={<PictureInPicture2 />}
                label="Picture in picture"
                shortcut="browser.picture_in_picture"
                onSelect={commands.pictureInPicture}
              />
            )}
            <MenuSubmenu icon={<Share2 />} label="Share" width="md">
              <Item icon={<Copy />} label="Copy link" onSelect={commands.copyLink} />
              <Item icon={<QrCode />} label="QR code…" onSelect={commands.qrCode} />
            </MenuSubmenu>
            <MenuSubmenu icon={<Wrench />} label="More tools" width="lg">
              {props.tools ? (
                <>
                  {props.tools}
                  <DropdownMenuSeparator />
                </>
              ) : null}
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
            <Item
              icon={<Puzzle />}
              label="Extensions"
              onSelect={() =>
                window.dispatchEvent(
                  new CustomEvent("misty:open-settings", {
                    detail: { section: "browser-extensions" },
                  }),
                )
              }
            />
            <Item icon={<CircleHelp />} label="Help" onSelect={commands.help} />
            <Item
              icon={<Settings2 />}
              label="Settings"
              onSelect={() =>
                // Settings is a modal over the page, not a tab of its own.
                window.dispatchEvent(
                  new CustomEvent("misty:open-settings", { detail: { section: "browser" } }),
                )
              }
            />
            {props.account}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
