import type { WorkspaceTab } from "@/features/workspace";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, ExternalLink, MoreVertical, RotateCw } from "lucide-react";
import { browserRuntimeId, useBrowserRuntimeStore } from "./browserRuntime";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";

interface BrowserMenuProps {
  iconButtonClass: string;
  nativeRuntime: boolean;
  tab: WorkspaceTab;
  url: string;
}

export function BrowserMenu(props: BrowserMenuProps) {
  const externalPage = /^https?:\/\//i.test(props.url);
  const suspensionReason = `browser-menu:${browserRuntimeId(props.tab)}`;
  const overlay = useBrowserOverlayControl(suspensionReason);

  const reportError = (error: unknown) => {
    useBrowserRuntimeStore
      .getState()
      .setError(props.tab.id, error instanceof Error ? error.message : String(error));
  };

  const reload = async () => {
    if (!props.nativeRuntime) return;
    try {
      await invoke("browser_webview_reload", {
        request: { id: browserRuntimeId(props.tab) },
      });
    } catch (error: unknown) {
      reportError(error);
    }
  };

  const copyAddress = async () => {
    try {
      if (props.nativeRuntime) await writeText(props.url);
      else await navigator.clipboard.writeText(props.url);
      useBrowserRuntimeStore.getState().setNotice(props.tab.id, "Address copied.");
      window.setTimeout(
        () => useBrowserRuntimeStore.getState().setNotice(props.tab.id, null),
        2_500,
      );
    } catch (error: unknown) {
      reportError(error);
    }
  };

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
          onSelect={() => void openSystemExternalLink(props.url).catch(reportError)}
        >
          <ExternalLink />
          Open in default browser
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
