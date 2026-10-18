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
  KeyRound,
  ExternalLink,
  FileDown,
  MoreHorizontal,
  MoreVertical,
  BookOpenText,
  Languages,
  PictureInPicture2,
  Plus,
  Printer,
  QrCode,
  Search,
  Settings,
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
  /** Rows closing the menu: sync. */
  account?: ReactNode;
  /** Rows above the browser's own, such as the sidebar's bookmark, Misty and extensions. */
  lead?: ReactNode;
  /** The trigger is a tools icon, as in the vertical-tabs sidebar's address field. */
  toolsIcon?: boolean;
  /** Page tools that used to sit in the toolbar; they lead the More tools submenu. */
  tools?: ReactNode;
  /** The pane layout submenu, after the window rows, where the toolbar has no button for it. */
  layout?: ReactNode;
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
            <MoreHorizontal {...toolbarIconProps} />
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
              label="Open Space"
              shortcut="workspace.open_space"
              onSelect={commands.newWindow}
            />
            <Item
              icon={<VenetianMask />}
              label="New incognito window"
              shortcut="workspace.new_incognito_window"
              onSelect={commands.newIncognitoWindow}
            />
            {props.layout}
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
            <Item
              icon={<KeyRound />}
              label="Passwords"
              onSelect={() => commands.openPage("passwords")}
            />
            {props.app ? <SiteAppsMenu {...props.app} url={props.url} /> : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <BrowserZoomControls zoom={zoom} menu />
        {commands ? (
          <>
            <Item
              icon={<Search />}
              label="Find…"
              shortcut="browser.find"
              onSelect={commands.find}
            />
            <MenuSubmenu icon={<Wrench />} label="More tools" width="lg">
              {props.tools ? (
                <>
                  {props.tools}
                  <DropdownMenuSeparator />
                </>
              ) : null}
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
              <Item
                icon={<Printer />}
                label="Print…"
                shortcut="browser.print"
                onSelect={commands.print}
              />
              <Item icon={<FileDown />} label="Save page as…" onSelect={commands.savePage} />
              <DropdownMenuSeparator />
              <Item icon={<Copy />} label="Copy link" onSelect={commands.copyLink} />
              <Item icon={<QrCode />} label="QR code…" onSelect={commands.qrCode} />
              <Item
                icon={<ExternalLink />}
                label="Open in default browser"
                onSelect={
                  canOpenExternal
                    ? () => void props.openExternal(props.url).catch(props.reportError)
                    : undefined
                }
              />
              <DropdownMenuSeparator />
              <Item
                icon={<Eraser />}
                label="Clear browsing data…"
                shortcut="browser.clear_data"
                onSelect={commands.clearBrowsingData}
              />
              <Item
                icon={<Code2 />}
                label="Developer tools"
                shortcut="browser.developer_tools"
                onSelect={commands.developerTools}
              />
              <Item icon={<CircleHelp />} label="Help" onSelect={commands.help} />
            </MenuSubmenu>
            <Item
              icon={<Settings />}
              label="Settings"
              shortcut="app.open_settings"
              onSelect={() => window.dispatchEvent(new CustomEvent("misty:open-settings"))}
            />
            <DropdownMenuSeparator />
          </>
        ) : null}
        {commands ? props.account : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
