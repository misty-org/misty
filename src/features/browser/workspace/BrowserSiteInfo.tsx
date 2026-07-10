import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Info, LockKeyhole, ShieldAlert } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { browserToolbarStyles } from "./browserToolbarStyles";
import {
  type BrowserSiteInfo as SiteInfo,
  type SitePermissions,
  type SitePermissionDecision,
  permissionLabels,
} from "@/features/browser-workspace/sitePermissions";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";

export function BrowserSiteInfo({
  id,
  url,
  active,
  iconButtonClass,
}: {
  id: string;
  url: string;
  active: boolean;
  iconButtonClass: string;
}) {
  const { open, onOpenChange } = useBrowserOverlayControl(`site-info:${id}`);
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    onOpenChange(false);
    setInfo(null);
    generation.current += 1;
  }, [id, url, active, onOpenChange]);
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
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={iconButtonClass}
          aria-label="Site information and permissions"
          title="Site information and permissions"
        >
          <Info {...browserToolbarStyles.roundIcon} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-24px)] p-4">
        <h2 className="break-all text-sm font-medium">{info?.origin ?? "Site information"}</h2>
        {!info && !error ? (
          <p role="status" className="mt-3 text-sm text-cream-muted">
            Reading site settings…
          </p>
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
              {(["camera", "microphone"] as const).map((kind) => (
                <div
                  key={kind}
                  className="flex min-h-10 items-center justify-between gap-3 text-sm"
                >
                  <span>{kind === "camera" ? "Camera" : "Microphone"}</span>
                  <Select
                    disabled={busy || !info.persistent}
                    value={info.permissions[kind]}
                    onValueChange={(value) =>
                      void update({
                        ...info.permissions,
                        [kind]: value as SitePermissionDecision,
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-8 w-28"
                      aria-label={`${kind === "camera" ? "Camera" : "Microphone"} permission`}
                    >
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
              {!info.persistent && (
                <p className="text-sm text-cream-muted">
                  Temporary session · permissions aren’t saved
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={
                  busy ||
                  !info.persistent ||
                  Object.values(info.permissions).every((value) => value === "ask")
                }
                onClick={() => void update({ camera: "ask", microphone: "ask" })}
              >
                Reset permissions
              </Button>
            </div>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 break-words text-sm text-avatar-red">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
