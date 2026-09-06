import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";
import { Copy, ExternalLink, MoreVertical, RotateCw } from "lucide-react";
import { useBrowserOverlay } from "./useBrowserOverlay";

export interface BrowserMenuViewProps {
  iconButtonClass: string;
  setOverlay: (reason: string, active: boolean) => Promise<void>;
  reload: () => Promise<void>;
  copyAddress: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  reportError: (error: unknown) => void;
  url: string;
}

export function BrowserMenuView(props: BrowserMenuViewProps) {
  const externalPage = /^https?:\/\//i.test(props.url);
  const overlay = useBrowserOverlay("menu", props.setOverlay);
  const reload = () => props.reload().catch(props.reportError);
  const copyAddress = () => props.copyAddress().catch(props.reportError);
  return (
    <DropdownMenu modal={false} open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`${props.iconButtonClass} select-none`}
          aria-label="Browser menu"
          onMouseDown={(event) => {
            if (event.detail > 1) event.preventDefault();
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            window.getSelection()?.removeAllRanges();
          }}
        >
          <MoreVertical size={20} strokeWidth={1.8} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="min-w-52 data-[state=closed]:animate-none data-[state=open]:animate-none"
      >
        <DropdownMenuItem onSelect={() => void reload()}>
          <RotateCw />
          Reload
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyAddress()}>
          <Copy />
          Copy address
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!externalPage}
          onSelect={() => void props.openExternal(props.url).catch(props.reportError)}
        >
          <ExternalLink />
          Open in default browser
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
