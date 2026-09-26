import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/shared/ui";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";

/** Share this page with a phone: scan the code to open the same address. */
export function BrowserQrCodeDialog(props: {
  request: number;
  url: string;
  suspensionReason: string;
}) {
  const overlay = useBrowserOverlayControl(props.suspensionReason);
  const [url, setUrl] = useState(props.url);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!props.request) return;
    setUrl(props.url);
    setCopied(false);
    overlay.onOpenChange(true);
    // Capture the address at the moment the code was asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request]);
  return (
    <Dialog open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>Scan to open this page</DialogTitle>
        <DialogDescription>Point a phone's camera at the code.</DialogDescription>
        <div className="grid justify-items-center gap-3 py-2">
          <div className="rounded-xl bg-white p-3">
            <QRCodeSVG value={url} size={200} level="M" />
          </div>
          <p className="max-w-full truncate text-xs text-cream-muted" title={url}>
            {url}
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard.writeText(url).then(() => setCopied(true))
            }
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button type="button" onClick={() => overlay.onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
