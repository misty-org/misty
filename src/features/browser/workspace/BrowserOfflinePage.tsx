import { blankBrowserUrl } from "@/features/workspace/model";
import { Button, cn } from "@/shared/ui";
import { Globe, RotateCw, WifiOff } from "lucide-react";
import { useState } from "react";

interface BrowserOfflinePageProps {
  url: string;
  onRetry: () => void;
  onGoHome?: () => void;
}

export function BrowserOfflinePage({ url, onRetry, onGoHome }: BrowserOfflinePageProps) {
  const [retrying, setRetrying] = useState(false);
  const [showTips, setShowTips] = useState(false);

  const handleRetry = () => {
    setRetrying(true);
    onRetry();
    window.setTimeout(() => setRetrying(false), 1000);
  };

  const isBlank = !url || url === blankBrowserUrl;

  return (
    <div
      className="grid h-full w-full select-none place-items-center overflow-y-auto bg-charcoal-bg p-6"
      data-testid="browser-offline-page"
    >
      <div className="flex w-full max-w-sm flex-col items-center text-center text-cream">
        <WifiOff className="mb-4 size-6 text-cream-muted" aria-hidden="true" />
        <h1 className="mb-1.5 text-base font-semibold">Cannot connect to the internet</h1>
        <p className="mb-5 text-sm leading-5 text-cream-muted">
          Misty could not load this page because your device appears to be offline. Check your
          network connection and try again.
        </p>

        {!isBlank ? (
          <p className="mb-5 flex w-full items-center justify-center gap-1.5 text-xs text-cream-muted">
            <Globe className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{url}</span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={handleRetry} disabled={retrying}>
            <RotateCw className={cn("size-3.5", retrying && "animate-spin")} />
            {retrying ? "Checking connection…" : "Try again"}
          </Button>
          {onGoHome ? (
            <Button variant="outline" onClick={onGoHome}>
              Go to home page
            </Button>
          ) : null}
        </div>

        <div className="mt-6 flex w-full flex-col items-center">
          <Button
            variant="ghost"
            size="xs"
            className="text-cream-muted"
            aria-expanded={showTips}
            onClick={() => setShowTips((prev) => !prev)}
          >
            Troubleshooting tips
          </Button>
          {showTips ? (
            <ul className="mt-2 grid max-w-xs list-disc gap-1 pl-4 text-left text-xs leading-5 text-cream-muted">
              <li>Check your Wi-Fi or Ethernet connection</li>
              <li>Restart your router or modem</li>
              <li>Check firewall, VPN or proxy settings</li>
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
