import type { WorkspaceView } from "@/features/workspace";
import { browserRuntimeId } from "@/features/webviews/browserRuntime";
import { BrowserBookmarkDialog } from "./BrowserBookmarkDialog";
import { BrowserClearDataDialog } from "./BrowserClearDataDialog";
import { BrowserHelpDialog } from "./BrowserHelpDialog";
import { BrowserQrCodeDialog } from "./BrowserQrCodeDialog";
import type { useBrowserPageCommands } from "./useBrowserPageCommands";

/** The dialogs a browser tab's menu commands open: bookmark, QR code, help and clear data. */
export function BrowserPageDialogs(props: {
  tab: WorkspaceView;
  url: string;
  profileId?: string;
  page: ReturnType<typeof useBrowserPageCommands>;
}) {
  const runtimeId = browserRuntimeId(props.tab);
  return (
    <>
      <BrowserBookmarkDialog
        request={props.page.bookmarkRequest}
        url={props.url}
        title={props.tab.title}
        suspensionReason={`browser-bookmark:${runtimeId}`}
      />
      <BrowserQrCodeDialog
        request={props.page.qrCodeRequest}
        url={props.url}
        suspensionReason={`browser-qr-code:${runtimeId}`}
      />
      <BrowserHelpDialog
        request={props.page.helpRequest}
        suspensionReason={`browser-help:${runtimeId}`}
      />
      <BrowserClearDataDialog
        request={props.page.clearDataRequest}
        tabId={props.tab.id}
        profileId={props.profileId}
        suspensionReason={`browser-clear-data:${runtimeId}`}
      />
    </>
  );
}
