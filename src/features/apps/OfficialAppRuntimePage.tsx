import { assertAppCompatible } from "./appCompatibility";
import { appsApi, type OfficialApp, type OfficialAppSession } from "@/api/apps";
import { resolveRequiredApiBase } from "@/api/client";
import { useAuth } from "@/features/auth";
import {
  installOfficialDesktopPackage,
  officialDesktopPackageReady,
} from "@/features/apps/desktop-package-runtime";
import { preferredDefaultSpace, useSpacesStore } from "@/features/spaces/core";
import type { WorkspaceTab } from "@/features/workspace/core";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { Button } from "@/shared/ui";
import { AlertCircle, LoaderCircle, RotateCw, Store } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { MiniAppRuntime } from "./MiniAppRuntime";
import { MINI_APP_PROTOCOL_VERSION } from "./miniAppProtocol";
import { officialAppNeedsReview } from "./appInstallationStatus";
import { useAppsStore } from "./useAppsStore";
import { canonicalAppRoute } from "./appRoute";
import { isTrustedHostApp } from "./trustedHostApps";
import { DownloadedAppSurface } from "./DownloadedAppSurface";
import { TrustedAppSurface } from "./TrustedAppSurface";

const refreshBeforeExpiryMs = 45_000;

export function OfficialAppRuntimePage(
  props: { appId?: string; spaceId?: string; tab?: WorkspaceTab; active?: boolean } = {},
) {
  const params = useParams();
  const location = useLocation();
  const workspaceRoute = new URL(
    canonicalAppRoute(props.tab?.route ?? `${location.pathname}${location.search}`),
    "https://misty.local",
  );
  const navigate = useNavigate();
  const { user } = useAuth();
  const requestedAppId = props.appId ?? params.appId ?? "";
  const appId = requestedAppId === "transfers" ? "files" : requestedAppId;
  const runtimeTab =
    props.tab && requestedAppId === "transfers"
      ? {
          ...props.tab,
          groupKey: "app:files" as const,
          instanceKey: "files",
          route: `${workspaceRoute.pathname}${workspaceRoute.search}`,
        }
      : props.tab;
  const catalog = useAppsStore((state) => state.catalog);
  const installations = useAppsStore((state) => state.installations);
  const appsReady = useAppsStore((state) => state.ready);
  const appsLoading = useAppsStore((state) => state.loading);
  const loadApps = useAppsStore((state) => state.load);
  const spaces = useSpacesStore((state) => state.spaces);
  const requestedSpaceId = props.spaceId ?? workspaceRoute.searchParams.get("space") ?? "";
  const space = requestedSpaceId
    ? spaces.find((candidate) => candidate.id === requestedSpaceId)
    : preferredDefaultSpace(spaces);
  const offeredApp = catalog.find((candidate) => candidate.id === appId);
  // Catalog refreshes must not replace an executing component or its permission ceiling.
  const pinnedApp = useRef<{ key: string; app: OfficialApp } | null>(null);
  const pinnedKey = JSON.stringify([user?.id, appId, props.tab?.id]);
  if (pinnedApp.current?.key !== pinnedKey) pinnedApp.current = null;
  const app = pinnedApp.current?.app ?? offeredApp;
  const trustedHostApp = app ? isTrustedHostApp(app) : false;
  const installation = installations.find((candidate) => candidate.app_id === appId);
  const sessionContext = JSON.stringify([user?.id, appId, space?.id]);
  const [connection, setConnection] = useState<{
    context: string;
    session: OfficialAppSession;
  } | null>(null);
  const session = connection?.context === sessionContext ? connection.session : null;
  const connectionAttempt = useRef(0);
  const [serverBase, setServerBase] = useState("");
  const [error, setError] = useState("");
  const source = useMemo(() => (app ? officialRuntimeEntry(app) : null), [app]);
  const needsReview = app && !pinnedApp.current ? officialAppNeedsReview(app, installation) : false;

  useEffect(() => {
    if (user?.id && !appsReady && !appsLoading) void loadApps(user.id);
  }, [appsLoading, appsReady, loadApps, user?.id]);

  const connect = useCallback(async () => {
    const runtime = isNativeMobileBuild ? app?.mobile.runtime : app?.desktop.runtime;
    if (
      !app ||
      (trustedHostApp && runtime === "embedded") ||
      installation?.state !== "installed" ||
      needsReview ||
      (runtime !== "hosted" && runtime !== "downloaded")
    ) {
      return;
    }
    const attempt = ++connectionAttempt.current;
    setError("");
    try {
      assertAppCompatible(app);
      if (!isNativeMobileBuild && !(await officialDesktopPackageReady(app))) {
        await installOfficialDesktopPackage(app);
      }
      const [nextSession, nextServerBase] = await Promise.all([
        appsApi.createSession(app.id, space?.id),
        resolveRequiredApiBase(),
      ]);
      if (attempt !== connectionAttempt.current) return;
      pinnedApp.current = { key: pinnedKey, app };
      setConnection({ context: sessionContext, session: nextSession });
      setServerBase(nextServerBase);
    } catch (caught) {
      if (attempt !== connectionAttempt.current) return;
      setError(caught instanceof Error ? caught.message : "This app could not be opened.");
    }
  }, [app, installation?.state, needsReview, space?.id, sessionContext, trustedHostApp, pinnedKey]);

  useEffect(() => {
    void connect();
    return () => {
      connectionAttempt.current += 1;
    };
  }, [connect]);

  useEffect(() => {
    if (!session) return;
    const delay = Math.max(
      5_000,
      new Date(session.expires_at).getTime() - Date.now() - refreshBeforeExpiryMs,
    );
    const timer = window.setTimeout(() => void connect(), delay);
    return () => window.clearTimeout(timer);
  }, [connect, session]);

  if (!appsReady) return <RuntimeLoading label="Checking installed apps" />;
  if (!app || installation?.state !== "installed") {
    return (
      <RuntimeState
        icon={Store}
        title="Add this App to Misty first"
        description="You can add it from Discover and open it here right away."
        action="Open Discover"
        onAction={() => navigate("/discover")}
      />
    );
  }

  if (needsReview) {
    return (
      <RuntimeState
        icon={Store}
        title={`Review ${app.name} update`}
        description="This app needs broader permissions. Review the update in Discover before opening it."
        action="Open Discover"
        onAction={() => navigate(`/discover?app=${encodeURIComponent(app.id)}`)}
      />
    );
  }

  if (app.minimum_host_protocol > MINI_APP_PROTOCOL_VERSION) {
    return (
      <RuntimeState
        icon={AlertCircle}
        title="Misty update required"
        description={`${app.name} needs a newer version of the Misty App runtime.`}
      />
    );
  }

  const runtime = isNativeMobileBuild ? app.mobile.runtime : app.desktop.runtime;
  if (runtime === "unsupported") {
    return (
      <RuntimeState
        icon={AlertCircle}
        title="Available on desktop"
        description={`${app.name} needs desktop capabilities and cannot run on this device.`}
      />
    );
  }
  if (trustedHostApp && runtime === "embedded" && user) {
    return (
      <TrustedAppSurface
        key={`${user.id}:${app.id}:${space?.id ?? ""}`}
        app={app}
        space={space}
        tab={runtimeTab}
        active={props.active}
        route={`${workspaceRoute.pathname}${workspaceRoute.search}`}
      />
    );
  }
  if (!source) {
    return (
      <RuntimeState
        icon={AlertCircle}
        title="App package unavailable"
        description="Misty could not verify an entry point for this app."
        action="Try again"
        onAction={() => void connect()}
      />
    );
  }
  if (error && !session) {
    return (
      <RuntimeState
        icon={AlertCircle}
        title={`Couldn’t open ${app.name}`}
        description={error}
        action="Try again"
        onAction={() => void connect()}
      />
    );
  }
  if (!session || !user || !serverBase) {
    return <RuntimeLoading label={`Opening ${app.name}`} />;
  }

  if (trustedHostApp && !isNativeMobileBuild && runtime === "downloaded") {
    return (
      <DownloadedAppSurface
        app={app}
        session={session}
        serverBase={serverBase}
        user={user}
        space={space}
        tab={runtimeTab}
        active={props.active}
        route={`${workspaceRoute.pathname}${workspaceRoute.search}`}
        onNavigate={navigate}
      />
    );
  }

  return (
    <MiniAppRuntime
      app={app}
      session={session}
      source={source}
      serverBase={serverBase}
      apiBase={`${serverBase}/app-runtime`}
      user={user}
      space={space}
      tab={runtimeTab}
      active={props.active}
      route={workspaceRoute.pathname}
      search={workspaceRoute.search}
      onNavigate={navigate}
    />
  );
}

function officialRuntimeEntry(app: OfficialApp): URL | null {
  if (!isNativeMobileBuild && app.desktop.runtime === "downloaded") {
    const base = navigator.userAgent.includes("Windows")
      ? "http://misty-extension.localhost"
      : "misty-extension://localhost";
    return new URL(`/public/${encodeURIComponent(app.id)}/web/index.html`, base);
  }
  const entry = app.mobile.entry?.trim();
  if (!entry) return null;
  const configured = import.meta.env.VITE_MISTY_OFFICIAL_APPS_ORIGIN?.trim();
  const fallback =
    import.meta.env.DEV && import.meta.env.VITE_MISTY_LOCAL_OFFICIAL_APPS === "true"
      ? window.location.origin
      : "https://apps.mistysys.com";
  try {
    const result = new URL(entry, configured || fallback);
    if (result.protocol !== "https:" && !(import.meta.env.DEV && result.protocol === "http:")) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

function RuntimeState(props: {
  icon: typeof AlertCircle;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  const Icon = props.icon;
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <div className="max-w-xs">
        <Icon className="mx-auto text-cream-muted" size={24} strokeWidth={1.6} aria-hidden="true" />
        <h1 className="mt-4 text-lg font-semibold text-cream-bright">{props.title}</h1>
        <p className="mt-2 text-sm leading-6 text-cream-muted">{props.description}</p>
        {props.action && props.onAction ? (
          <Button className="mt-5" variant="outline" onClick={props.onAction}>
            {props.action === "Try again" ? <RotateCw size={16} aria-hidden="true" /> : null}
            {props.action}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RuntimeLoading({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center bg-charcoal-bg" role="status">
      <LoaderCircle className="animate-spin text-cream-muted" size={22} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
