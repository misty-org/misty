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
import { Copy, ExternalLink, MoreVertical, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import {
  browserRuntimeId,
  setBrowserWebviewsSuspended,
  useBrowserRuntimeStore,
} from "./browserRuntime";

interface BrowserMenuProps {
  iconButtonClass: string;
  nativeRuntime: boolean;
  tab: WorkspaceTab;
  url: string;
}

export function BrowserMenu(props: BrowserMenuProps) {
  const suspensionReason = `browser-menu:${browserRuntimeId(props.tab)}`;
  const externalPage = /^https?:\/\//i.test(props.url);

  useEffect(() => () => setBrowserWebviewsSuspended(false, suspensionReason), [suspensionReason]);

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
    <DropdownMenu onOpenChange={(open) => setBrowserWebviewsSuspended(open, suspensionReason)}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={props.iconButtonClass} aria-label="Browser menu">
          <MoreVertical size={20} strokeWidth={1.8} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-52">
        <DropdownMenuItem onSelect={() => void reload()}>
          <RefreshCw />
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
