import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Info, LockKeyhole, ShieldAlert } from "lucide-react";
import {
  Button,
  ErrorNotification,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SkeletonList,
} from "@/shared/ui";
import { browserToolbarStyles } from "./browserToolbarStyles";
import {
  type BrowserSiteInfo as SiteInfo,
  type SitePermissions,
  type SitePermissionDecision,
  askForEverything,
  permissionLabels,
  sitePermissionKinds,
} from "@/features/browser/sitePermissions";
import {
  answerSitePermissionAsk,
  sitePermissionAskFor,
  sitePermissionAskText,
  useSitePermissionAsks,
} from "@/features/browser/sitePermissionAsks";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";
import { SiteStyleDialog } from "./SiteStyleDialog";

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function BrowserSiteInfo({ id, url, active }: { id: string; url: string; active: boolean }) {
  const { open, onOpenChange } = useBrowserOverlayControl(`site-info:${id}`);
  // A site asking for a permission opens this popup, with the question at the top.
  const ask = useSitePermissionAsks((state) => state.asks.find((open) => open.id === id));
  const [customizing, setCustomizing] = useState(false);
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const asking = sitePermissionAskFor(id);
    // A page can change its address while it asks; only leaving the site ends the question.
    const samePage = asking && originOf(url) === asking.topOrigin;
    if (asking && !samePage) void answerSitePermissionAsk(asking, "ask");
    if (samePage && active) return;
    onOpenChange(false);
    setInfo(null);
    generation.current += 1;
  }, [id, url, active, onOpenChange]);
  const requestId = ask?.requestId;
  useEffect(() => {
    if (requestId !== undefined && active) onOpenChange(true);
  }, [requestId, active, onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const current = ++generation.current;
    setInfo(null);
    setError(null);
    void invoke<SiteInfo>("browser_site_info", { id })
      .then((value) => {
        if (generation.current === current) setInfo(value);
      })
      .catch((reason: unknown) => {
        if (generation.current === current) setError(String(reason));
      });
    return () => {
      generation.current += 1;
    };
  }, [open, id]);
  const answer = async (decision: SitePermissionDecision) => {
    if (!ask || busy) return;
    setBusy(true);
    setError(null);
    try {
      await answerSitePermissionAsk(ask, decision);
      // The page behind this popup can only go on once it is out of the way.
      if (!sitePermissionAskFor(id)) onOpenChange(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const update = async (permissions: SitePermissions) => {
    if (!info || busy) return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const value = await invoke<SiteInfo>("browser_site_permissions_set", {
        id,
        origin: info.origin,
        permissions,
      });
      if (current === generation.current) setInfo(value);
    } catch (reason) {
      if (current === generation.current) {
        setError(String(reason));
        // Saving can succeed even if stopping an active stream fails afterward.
        // Re-read policy so the panel never presents an old allowance as current.
        setInfo(null);
        try {
          const saved = await invoke<SiteInfo>("browser_site_info", { id });
          if (current === generation.current && saved.origin === info.origin) setInfo(saved);
        } catch {
          /* Keep the warning and hide uncertain decisions until reopened. */
        }
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SiteStyleDialog
        open={customizing}
        runtimeId={id}
        url={url}
        onClose={() => setCustomizing(false)}
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Closing without an answer refuses this time and saves nothing.
          if (!next && ask) void answerSitePermissionAsk(ask, "ask");
          onOpenChange(next);
        }}
      >
        <PopoverTrigger asChild>
          <IconButton label="Site information and permissions" tooltip={false}>
            <Info {...browserToolbarStyles.roundIcon} />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-24px)] p-4">
          {ask ? (
            <div className="mb-4 border-b border-charcoal-border pb-4">
              <h2 className="break-words text-sm font-medium">{sitePermissionAskText(ask)}</h2>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void answer("block")}
                >
                  Block
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void answer("allow")}
                >
                  Allow
                </Button>
              </div>
            </div>
          ) : null}
          <h2 className="break-all text-sm font-medium">{info?.origin ?? "Site information"}</h2>
          {ask ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                onOpenChange(false);
                setCustomizing(true);
              }}
            >
              Customize this site…
            </Button>
          )}
          {!info && !error ? (
            <SkeletonList
              label="Site settings"
              rows={3}
              leading="none"
              lines={1}
              trailing
              className="mt-3"
            />
          ) : null}
          {info ? (
            <>
              <p className="mt-3 flex items-center gap-2 text-sm text-cream-muted">
                {info.secure ? (
                  <LockKeyhole size={16} aria-hidden />
                ) : (
                  <ShieldAlert size={16} aria-hidden />
                )}
                {info.secure ? "Encrypted connection" : "Not secure"}
              </p>
              <div className="mt-4 space-y-2 border-t border-charcoal-border pt-3">
                {sitePermissionKinds.map(({ kind, label }) => (
                  <div
                    key={kind}
                    className="flex min-h-10 items-center justify-between gap-3 text-sm"
                  >
                    <span>{label}</span>
                    <Select
                      disabled={busy}
                      value={info.permissions[kind]}
                      onValueChange={(value) =>
                        void update({
                          ...info.permissions,
                          [kind]: value as SitePermissionDecision,
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-28" aria-label={`${label} permission`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {Object.entries(permissionLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {info.locationBlocked && info.permissions.location !== "block" && (
                  <p className="text-sm text-cream-muted">
                    macOS is blocking location for Misty. Turn it on in System Settings, under
                    Privacy &amp; Security and Location Services.
                  </p>
                )}
                {!info.persistent && (
                  <p className="text-sm text-cream-muted">
                    Permissions apply only to this temporary session.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={
                    busy || Object.values(info.permissions).every((value) => value === "ask")
                  }
                  onClick={() => void update(askForEverything)}
                >
                  Reset permissions
                </Button>
              </div>
            </>
          ) : null}
          <ErrorNotification message={error} onDismiss={() => setError(null)} />
        </PopoverContent>
      </Popover>
    </>
  );
}
