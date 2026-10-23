import type { BrowserMistyPage } from "@/features/webviews/browserRuntime";
import { DropdownMenuCheckboxItem } from "@/shared/ui";
import { Pencil } from "lucide-react";
import { BrowserAgentAccessMenu } from "./BrowserAgentAccessMenu";
import { BrowserClipboardButton } from "./BrowserClipboardButton";
import { BrowserViewportMenu } from "./BrowserViewportMenu";
import type {
  BrowserViewport,
  BrowserViewportDevice,
  BrowserViewportSize,
} from "./browserViewport";

/** The browser menu's tools for this page: annotate, viewport size, Misty's access, clipboard. */
export function BrowserMenuTools(props: {
  annotating: boolean;
  onAnnotatingChange: (annotating: boolean) => void;
  viewport: BrowserViewport;
  onViewportChange: (viewport: BrowserViewport) => void;
  viewportSizes: Record<BrowserViewportDevice, BrowserViewportSize>;
  onViewportSizeChange: (device: BrowserViewportDevice, size: BrowserViewportSize) => void;
  nativeRuntime: boolean;
  mistyPage: BrowserMistyPage | null;
  mistyPageLoading: boolean;
  onAttachPage: () => void;
}) {
  return (
    <>
      <DropdownMenuCheckboxItem
        checked={props.annotating}
        onCheckedChange={(checked) => props.onAnnotatingChange(checked === true)}
      >
        <Pencil />
        <span className="min-w-0 flex-1 truncate">Annotate page</span>
      </DropdownMenuCheckboxItem>
      <BrowserViewportMenu
        value={props.viewport}
        onChange={props.onViewportChange}
        sizes={props.viewportSizes}
        onSizeChange={props.onViewportSizeChange}
      />
      <BrowserAgentAccessMenu
        nativeRuntime={props.nativeRuntime}
        mistyPage={props.mistyPage}
        mistyPageLoading={props.mistyPageLoading}
        onAttachPage={props.onAttachPage}
      />
      <BrowserClipboardButton />
    </>
  );
}
