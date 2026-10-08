import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Info, LockKeyhole, ShieldAlert } from "lucide-react";
import {
  Button,
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
  Switch,
} from "@/shared/ui";
import { settingsBoolean, settingsString, useSettingsStore } from "@/features/settings";
import {
  contentBlockingAllowedOn,
  contentBlockingSettingWith,
  contentBlockingSite,
  parseContentBlockingAllowedSites,
} from "@/features/webviews/contentBlocking";
import { browserToolbarStyles } from "./browserToolbarStyles";
import {
  type BrowserSiteInfo as SiteInfo,
  type SitePermissions,
  type SitePermissionDecision,
  permissionLabels,
} from "@/features/browser-workspace/sitePermissions";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";
import { SiteStyleDialog } from "./SiteStyleDialog";

export function BrowserSiteInfo({ id, url, active }: { id: string; url: string; active: boolean }) {
  const { open, onOpenChange } = useBrowserOverlayControl(`site-info:${id}`);
  const [customizing, setCustomizing] = useState(false);
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
    <>
      <SiteStyleDialog
        open={customizing}
        runtimeId={id}
        url={url}
        onClose={() => setCustomizing(false)}
      />
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <IconButton label="Site information and permissions" tooltip={false}>
            <Info {...browserToolbarStyles.roundIcon} />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-24px)] p-4">
          <h2 className="break-all text-sm font-medium">{info?.origin ?? "Site information"}</h2>
          <ContentBlockingRow url={url} />
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
          {!info && !error ? (
            <SkeletonList
              label="Site settings"
              rows={2}
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
                {(["camera", "microphone"] as const).map((kind) => (
                  <div
                    key={kind}
                    className="flex min-h-10 items-center justify-between gap-3 text-sm"
                  >
                    <span>{kind === "camera" ? "Camera" : "Microphone"}</span>
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
    </>
  );
}

/** Turns ad and tracker blocking off or on for this site, while blocking is on. */
function ContentBlockingRow({ url }: { url: string }) {
  const enabled = useSettingsStore((state) =>
    settingsBoolean(state.settings?.document ?? {}, "general", "browser_content_blocking", true),
  );
  const raw = useSettingsStore((state) =>
    settingsString(
      state.settings?.document ?? {},
      "general",
      "browser_content_blocking_allowed_json",
      "[]",
    ),
  );
  if (!enabled || !contentBlockingSite(url)) return null;
  const blocked = !contentBlockingAllowedOn(parseContentBlockingAllowedSites(raw), url);
  return (
    <label className="mt-3 flex min-h-10 items-center justify-between gap-3 text-sm">
      <span>Block ads and trackers</span>
      <Switch
        checked={blocked}
        onCheckedChange={(checked) => {
          const next = contentBlockingSettingWith(raw, url, checked);
          if (next !== null)
            useSettingsStore
              .getState()
              .updateSetting("general", "browser_content_blocking_allowed_json", next);
        }}
      />
    </label>
  );
}
