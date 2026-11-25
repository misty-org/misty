// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useCallback, useEffect, useRef, useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { DesktopSettingsNotice, DesktopSettingsRow } from "@/features/settings";
import { Button, ErrorState, Input, Skeleton, Switch } from "@misty/ui";
import { proxyApi, type ProxySettings } from "./api";

const DEFAULT_PROXY_URL = "http://127.0.0.1:7890";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const PROXY_KEY = "engine-config/proxy";

export function NetworkSection() {
  const proxy = useCachedResource<ProxySettings>(PROXY_KEY, proxyApi.get, { persist: false });
  const settings = proxy.data ?? null;
  const setProxy = proxy.set;
  const [enabledDraft, setEnabledDraft] = useState(() => settings?.enabled ?? false);
  const [urlDraft, setUrlDraft] = useState(() => settings?.url ?? DEFAULT_PROXY_URL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const synced = useRef(settings);
  const drafts = useRef({ enabled: enabledDraft, url: urlDraft });
  useEffect(() => {
    drafts.current = { enabled: enabledDraft, url: urlDraft };
  }, [enabledDraft, urlDraft]);
  useEffect(() => {
    if (!settings || settings === synced.current) return;
    const before = synced.current;
    const edited = before
      ? drafts.current.enabled !== before.enabled ||
        drafts.current.url !== (before.url ?? DEFAULT_PROXY_URL)
      : drafts.current.enabled !== false || drafts.current.url !== DEFAULT_PROXY_URL;
    synced.current = settings;
    if (edited) return;
    setEnabledDraft(settings.enabled);
    setUrlDraft(settings.url ?? DEFAULT_PROXY_URL);
  }, [settings]);
  const loadError = proxy.error && !settings && !proxy.loading ? errorText(proxy.error) : null;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const persist = useCallback(
    async (enabled: boolean, url: string | null, done: string, rollback: ProxySettings) => {
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const saved = await proxyApi.set(enabled, url);
        synced.current = saved;
        setProxy(saved);
        setNotice(done);
        return true;
      } catch (e) {
        setEnabledDraft(rollback.enabled);
        setUrlDraft(rollback.url ?? DEFAULT_PROXY_URL);
        setError(errorText(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [setProxy],
  );

  const persisted: ProxySettings = settings ?? { enabled: false, url: null };
  const persistedUrl = persisted.url ?? DEFAULT_PROXY_URL;

  const onToggle = (checked: boolean) => {
    if (saving || !settings) return;
    const trimmed = urlDraft.trim();
    if (checked && !trimmed) {
      setError("Enter a proxy address to turn the proxy on.");
      return;
    }
    setEnabledDraft(checked);
    void persist(
      checked,
      trimmed || null,
      checked
        ? "The proxy is on for engines started from now."
        : "The proxy is off; new requests go direct.",
      persisted,
    );
  };

  const onSave = () => {
    if (saving || !settings) return;
    const trimmed = urlDraft.trim();
    if (enabledDraft && !trimmed) {
      setError("Enter a proxy address to turn the proxy on.");
      return;
    }
    void persist(enabledDraft, trimmed || null, "Proxy saved.", persisted);
  };

  const dirty = persisted.enabled !== enabledDraft || persistedUrl !== urlDraft;

  return (
    <>
      {error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null}
      {notice ? <DesktopSettingsNotice>{notice}</DesktopSettingsNotice> : null}
      {loadError ? (
        <ErrorState
          inline
          title="Couldn't read the proxy"
          line={loadError}
          action={{ label: "Try again", onClick: () => void proxy.reload() }}
        />
      ) : (
        <>
          <DesktopSettingsRow
            label="Use a proxy"
            description="For the engines Misty starts and its downloads of skills, versions and prices."
          >
            {settings ? (
              <Switch
                aria-label="Use a proxy"
                checked={enabledDraft}
                disabled={saving}
                onCheckedChange={onToggle}
              />
            ) : (
              <Skeleton className="h-5 w-9 rounded-full" />
            )}
          </DesktopSettingsRow>
          {enabledDraft ? (
            <DesktopSettingsRow
              label="Proxy address"
              description="http, https or socks5. SOCKS reaches the engines only."
            >
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Proxy address"
                  className="w-64"
                  value={urlDraft}
                  placeholder={DEFAULT_PROXY_URL}
                  disabled={!settings}
                  onChange={(event) => {
                    setUrlDraft(event.target.value);
                    setError(null);
                  }}
                />
                <Button variant="primary" disabled={!settings || saving || !dirty} onClick={onSave}>
                  Save
                </Button>
              </div>
            </DesktopSettingsRow>
          ) : null}
        </>
      )}
    </>
  );
}
