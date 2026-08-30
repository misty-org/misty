import { blankBrowserUrl } from "@/features/workspace";
import { cn } from "@/shared/ui";
import { AlertCircle, ArrowLeft, Globe, RotateCw, WifiOff } from "lucide-react";
import { useState } from "react";

interface BrowserOfflinePageProps {
  url: string;
  onRetry: () => void;
  onGoHome?: () => void;
  lightChrome?: boolean;
}

export function BrowserOfflinePage({
  url,
  onRetry,
  onGoHome,
  lightChrome = false,
}: BrowserOfflinePageProps) {
  const [retrying, setRetrying] = useState(false);
  const [showTips, setShowTips] = useState(false);

  const handleRetry = () => {
    setRetrying(true);
    onRetry();
    window.setTimeout(() => setRetrying(false), 1000);
  };

  const isBlank = !url || url === blankBrowserUrl;

  const cardClass = cn(
    "flex w-full max-w-md flex-col items-center text-center",
    "rounded-2xl border p-8 shadow-xl backdrop-blur-sm transition-all",
    lightChrome
      ? "border-black/10 bg-white/90 text-[#222]"
      : "border-charcoal-border bg-charcoal-card/90 text-cream",
  );

  const pillClass = cn(
    "flex max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs",
    lightChrome
      ? "border-black/10 bg-black/[0.03] text-[#555]"
      : "border-charcoal-border/80 bg-black/30 text-cream-muted",
  );

  const primaryButtonClass = cn(
    "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-all shadow-sm",
    lightChrome
      ? "bg-[#222] text-white hover:bg-[#333] active:scale-[0.98]"
      : "bg-cream text-charcoal-bg hover:bg-cream/90 active:scale-[0.98]",
  );

  const secondaryButtonClass = cn(
    "flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium transition-all",
    lightChrome
      ? "border-black/10 bg-transparent text-[#555] hover:bg-black/[0.04]"
      : "border-charcoal-border bg-transparent text-cream-muted hover:bg-white/[0.05] hover:text-cream",
  );

  return (
    <div
      className={cn(
        "grid h-full w-full select-none place-items-center overflow-y-auto p-6",
        lightChrome ? "bg-[#f5f5f5]" : "bg-charcoal-bg",
      )}
      data-testid="browser-offline-page"
    >
      <div className={cardClass}>
        <div
          className={cn(
            "mb-5 grid size-14 place-items-center rounded-2xl border shadow-inner",
            lightChrome
              ? "border-amber-500/20 bg-amber-500/10 text-amber-600"
              : "border-amber-400/25 bg-amber-400/10 text-amber-400",
          )}
        >
          <WifiOff className="size-7" />
        </div>

        <h1 className="mb-2 text-base font-semibold tracking-tight">
          Cannot connect to the internet
        </h1>

        <p
          className={cn(
            "mb-5 max-w-sm text-xs leading-relaxed",
            lightChrome ? "text-[#666]" : "text-cream-muted",
          )}
        >
          Misty could not load this page because your device appears to be offline. Please check
          your network connection and try again.
        </p>

        {!isBlank ? (
          <div className="mb-6 w-full max-w-full">
            <div className={pillClass}>
              <Globe className="size-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate text-left">{url}</span>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className={primaryButtonClass}
          >
            <RotateCw className={cn("size-3.5", retrying && "animate-spin")} />
            <span>{retrying ? "Checking connection…" : "Try again"}</span>
          </button>

          {onGoHome ? (
            <button type="button" onClick={onGoHome} className={secondaryButtonClass}>
              <ArrowLeft className="size-3.5" />
              <span>Go to Home</span>
            </button>
          ) : null}
        </div>

        <div className="mt-6 w-full border-t border-charcoal-border/50 pt-4 text-left">
          <button
            type="button"
            onClick={() => setShowTips((prev) => !prev)}
            className={cn(
              "flex w-full items-center justify-between text-[11px] font-medium transition-colors",
              lightChrome ? "text-[#777] hover:text-[#222]" : "text-cream-faint hover:text-cream",
            )}
          >
            <span className="flex items-center gap-1.5">
              <AlertCircle className="size-3.5 text-amber-400/80" />
              <span>Troubleshooting tips</span>
            </span>
            <span>{showTips ? "Hide" : "Show"}</span>
          </button>

          {showTips ? (
            <ul
              className={cn(
                "mt-2.5 space-y-1.5 rounded-lg p-3 text-[11px] leading-relaxed",
                lightChrome ? "bg-black/[0.03] text-[#555]" : "bg-black/20 text-cream-muted",
              )}
            >
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
