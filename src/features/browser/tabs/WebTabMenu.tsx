import { invoke } from "@tauri-apps/api/core";
import {
  Clock,
  Ellipsis,
  ExternalLink,
  History,
  Languages,
  Link,
  PictureInPicture2,
  Printer,
  Save,
  SquareCode,
  SquarePen,
  TextSearch,
  Trash2,
  ZoomIn,
} from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  MenuTrigger,
  notify,
  useConfirmDelete,
} from "@misty/ui";
import { openExternalLink } from "@/shared/platform/open_external_link";
import { pageLabel } from "./web_address";

const zoomLevels = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export const zoomText = (zoom: number) => `${Math.round(zoom * 100)}%`;

export function WebTabMenu(props: {
  url: string;
  zoom: number;
  live: boolean;
  onFind(): void;
  onZoom(zoom: number): void;
  onGo(url: string): void;
  onPrint(): void;
  onSavePage(): void;
  onPictureInPicture(): void;
  onInspect(): void;
  onTranslate?(): void;
  onAnnotate?(): void;
  onShowHistory(): void;
}) {
  const [recent, setRecent] = useState<{ url: string; title: string }[]>([]);
  const web = /^https?:\/\//i.test(props.url);
  const loadRecent = (open: boolean) => {
    if (!open) return;
    void invoke<{ url: string; title: string }[]>("browser_history_recent", {
      request: { limit: 10 },
    })
      .then(setRecent)
      .catch(() => setRecent([]));
  };
  const copy = () =>
    void navigator.clipboard
      .writeText(props.url)
      .catch(() => notify({ message: "The link couldn't be copied", tone: "error" }));
  const { confirm, dialog } = useConfirmDelete();
  const clearHistory = () =>
    void confirm({
      title: "Clear your browsing history?",
      what: "Every page you visited in Misty's browser goes from this computer. This can't be undone.",
      confirmLabel: "Clear",
      onConfirm: async () => {
        await invoke("browser_history_clear");
        setRecent([]);
      },
    });

  return (
    <>
      {dialog}
      <DropdownMenu onOpenChange={loadRecent}>
        <MenuTrigger iconOnly icon={Ellipsis} label="More" />
        <DropdownMenuContent align="end">
          <MenuItem
            icon={TextSearch}
            label="Find on page"
            disabled={!props.live}
            onSelect={props.onFind}
          />
          <MenuSubmenu icon={ZoomIn} label={`Zoom ${zoomText(props.zoom)}`} disabled={!props.live}>
            <MenuRadioGroup
              value={String(props.zoom)}
              onValueChange={(value) => props.onZoom(Number(value))}
            >
              {zoomLevels.map((level) => (
                <MenuRadioItem key={level} value={String(level)} label={zoomText(level)} />
              ))}
            </MenuRadioGroup>
          </MenuSubmenu>
          {props.onTranslate ? (
            <MenuItem
              icon={Languages}
              label="Translate page"
              disabled={!props.live || !web}
              onSelect={props.onTranslate}
            />
          ) : null}
          {props.onAnnotate ? (
            <MenuItem
              icon={SquarePen}
              label="Annotate page"
              disabled={!props.live || !web}
              onSelect={props.onAnnotate}
            />
          ) : null}
          <MenuItem
            icon={PictureInPicture2}
            label="Picture in picture"
            disabled={!props.live}
            onSelect={props.onPictureInPicture}
          />
          <MenuSeparator />
          <MenuItem icon={Link} label="Copy link" disabled={!web} onSelect={copy} />
          <MenuItem
            icon={ExternalLink}
            label="Open in default browser"
            disabled={!web}
            onSelect={() => void openExternalLink(props.url)}
          />
          <MenuItem
            icon={Save}
            label="Save page"
            disabled={!props.live || !web}
            onSelect={props.onSavePage}
          />
          <MenuItem icon={Printer} label="Print" disabled={!props.live} onSelect={props.onPrint} />
          <MenuItem
            icon={SquareCode}
            label="Web Inspector"
            disabled={!props.live}
            onSelect={props.onInspect}
          />
          <MenuSeparator />
          <MenuSubmenu icon={Clock} label="History">
            {recent.map((page) => (
              <MenuItem
                key={page.url}
                label={pageLabel(page.url, page.title)}
                onSelect={() => props.onGo(page.url)}
              />
            ))}
            {recent.length ? <MenuSeparator /> : null}
            <MenuItem icon={History} label="Show all history" onSelect={props.onShowHistory} />
            <MenuItem icon={Trash2} label="Clear history" danger onSelect={clearHistory} />
          </MenuSubmenu>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
