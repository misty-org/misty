import { blankBrowserUrl } from "@/features/workspace/model";
import { Button, cn } from "@/shared/ui";
import { AlertCircle, ArrowLeft, Globe, RotateCw, WifiOff } from "lucide-react";
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
      <div
        className={cn(
          "flex w-full max-w-md flex-col items-center rounded-2xl border border-charcoal-border",
          "bg-charcoal-card/90 p-8 text-center text-cream shadow-xl",
        )}
      >
        <div className="mb-5 grid size-14 place-items-center rounded-2xl border border-amber-400/25 bg-amber-400/10 text-amber-400">
          <WifiOff className="size-7" />
        </div>

        <h1 className="mb-2 text-base font-semibold tracking-tight">
          Cannot connect to the internet
        </h1>

        <p className="mb-5 max-w-sm text-xs leading-relaxed text-cream-muted">
          Misty could not load this page because your device appears to be offline. Please check
          your network connection and try again.
        </p>

        {!isBlank ? (
          <div
            className={cn(
              "mb-6 flex w-full max-w-full items-center gap-2 rounded-lg border",
              "border-charcoal-border px-3 py-1.5 font-mono text-xs text-cream-muted",
            )}
          >
            <Globe className="size-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate text-left">{url}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={handleRetry} disabled={retrying}>
            <RotateCw className={cn("size-3.5", retrying && "animate-spin")} />
            {retrying ? "Checking connection…" : "Try again"}
          </Button>
          {onGoHome ? (
            <Button variant="outline" onClick={onGoHome}>
              <ArrowLeft className="size-3.5" />
              Go to Home
            </Button>
          ) : null}
        </div>

        <div className="mt-6 w-full border-t border-charcoal-border/50 pt-4 text-left">
          <Button
            variant="ghost"
            size="xs"
            justify="between"
            className="w-full text-[11px] text-cream-muted"
            aria-expanded={showTips}
            onClick={() => setShowTips((prev) => !prev)}
          >
            <span className="flex items-center gap-1.5">
              <AlertCircle className="size-3.5 text-amber-400/80" />
              Troubleshooting tips
            </span>
            <span>{showTips ? "Hide" : "Show"}</span>
          </Button>

          {showTips ? (
            <ul className="mt-2.5 space-y-1.5 rounded-lg bg-charcoal-bg/60 p-3 text-[11px] leading-relaxed text-cream-muted">
              <li>• Check Wi-Fi or Ethernet cables and connections</li>
              <li>• Try restarting your wireless router or modem</li>
              <li>• Verify firewall, VPN, or proxy settings</li>
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
