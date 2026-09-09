import { retainAppAccessRefresh } from "./appAccessRefresh";
import { installedDevelopmentRelease } from "@/api/apps/developmentRelease";
import { errorText } from "@/shared/lib/format";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import { discoverAppName } from "./appDetailsModel";
import { useAppDownloads } from "./useAppDownloads";
import { appConsentKey, useAppConsent } from "./useAppConsent";
import { assertAppCompatible } from "./appCompatibility";
import { appsApi, type OfficialApp, type OfficialAppSession } from "@/api/apps";
import { resolveRequiredApiBase } from "@/api/client";
import { useAuth } from "@/features/auth";
import { officialDesktopPackageReady } from "@/features/apps/desktop-package-runtime";
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
import { TrustedAppSurface } from "@/features/apps/TrustedAppSurface";

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

  const installationsBySpace = useAppsStore((state) => state.bySpace);

  const loadApps = useAppsStore((state) => state.load);
  const spaces = useSpacesStore((state) => state.spaces);
  const requestedSpaceId = props.spaceId ?? workspaceRoute.searchParams.get("space") ?? "";
  const space = requestedSpaceId
    ? spaces.find((candidate) => candidate.id === requestedSpaceId)
    : preferredDefaultSpace(spaces);
  const appsReady = installationsBySpace[space?.id ?? ""] !== undefined;
  const installation = (installationsBySpace[space?.id ?? ""] ?? []).find(
    (candidate) => candidate.app_id === appId,
  );
  const appsError = useAppsStore((state) => state.bySpaceErrors[space?.id ?? ""] ?? "");
  const savedRelease = installation?.release_metadata;
  const offeredCandidate = useMemo(
    () =>
      savedRelease?.id === appId && savedRelease.version === installation?.installed_version
        ? installedDevelopmentRelease(savedRelease, catalog)
        : catalog.find(
            (candidate) =>
              candidate.id === appId && candidate.version === installation?.installed_version,
          ),
    [savedRelease, appId, installation?.installed_version, catalog],
  );
  // Failed/pending connections need stable release identity too, not just running apps.
  const offeredSnapshot = useRef<
    { key: string | undefined; app: OfficialApp | undefined } | undefined
  >(undefined);
  const offeredKey = JSON.stringify(offeredCandidate);
  if (offeredSnapshot.current?.key !== offeredKey)
    offeredSnapshot.current = { key: offeredKey, app: offeredCandidate };
  const offeredApp = offeredSnapshot.current?.app;
  // Catalog refreshes must not replace an executing component or its permission ceiling.
  const pinnedApp = useRef<{ key: string; app: OfficialApp } | null>(null);
  const pinnedKey = JSON.stringify([
    user?.id,
    space?.id,
    appId,
    props.tab?.id,
    installationsBySpace[space?.id ?? ""]?.find((item) => item.app_id === appId)
      ?.authority_generation,
  ]);
  if (pinnedApp.current?.key !== pinnedKey) pinnedApp.current = null;
  const app = pinnedApp.current?.app ?? offeredApp;
  const removed = useAppDownloads((state) => Boolean(state.removed[appId]));
  const personalConsent = useAppConsent((state) =>
    Boolean(app && user?.id && state.agreed[appConsentKey(user.id, app)]),
  );
  const trustedHostApp = app ? isTrustedHostApp(app) : false;
  const sessionContext = JSON.stringify([
    user?.id,
    appId,
    space?.id,
    installation?.authority_generation,
  ]);
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
    if (!user?.id || !space?.id) return;
    return retainAppAccessRefresh(user.id, space.id);
  }, [loadApps, user?.id, space?.id]);

  const connect = useCallback(async () => {
    const runtime = isNativeMobileBuild ? app?.mobile.runtime : app?.desktop.runtime;
    if (
      !app ||
      !personalConsent ||
      removed ||
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
        await useAppDownloads.getState().get(app, true);
      }
      if (attempt !== connectionAttempt.current || useAppDownloads.getState().removed[app.id])
        return;
      const [nextSession, nextServerBase] = await Promise.all([
        appsApi.createSession(app.id, space?.id, installation.authority_generation),
        resolveRequiredApiBase(),
      ]);
      if (attempt !== connectionAttempt.current) return;
      if (
        !Number.isFinite(Date.parse(nextSession.expires_at)) ||
        Date.parse(nextSession.expires_at) <= Date.now()
      )
        throw new Error("The server returned an expired app session. Try again.");
      pinnedApp.current = { key: pinnedKey, app };
      setConnection({ context: sessionContext, session: nextSession });
      setServerBase(nextServerBase);
    } catch (caught) {
      if (attempt !== connectionAttempt.current) return;
      setError(errorText(caught).trim() || "This app could not be opened.");
    }
  }, [
    app,
    installation?.state,
    needsReview,
    space?.id,
    sessionContext,
    trustedHostApp,
    pinnedKey,
    personalConsent,
    removed,
  ]);

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

  if (!appsReady && appsError)
    return (
      <RuntimeState
        icon={AlertCircle}
        title="Apps could not be checked"
        description={appsError}
        action="Try again"
        onAction={() => {
          if (user?.id && space?.id) void loadApps(user.id, true, space.id);
        }}
      />
    );
  if (!appsReady) return <RuntimeLoading label="Checking installed apps" />;
  if (!app || installation?.state !== "installed") {
    return (
      <RuntimeState
        icon={Store}
        title="This app is not available in this Space"
        description="A Space manager can add or restore it from Discover."
        action="Open Discover"
        onAction={() => navigate("/discover")}
      />
    );
  }

  if (needsReview) {
    return (
      <RuntimeState
        icon={Store}
        app={app}
        title={discoverAppName(app)}
        description="Review the updated permissions in Discover to continue."
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
  if (removed)
    return (
      <RuntimeState
        icon={Store}
        app={app}
        title={discoverAppName(app)}
        description="Removed from this device. Get it again to use it in your Spaces."
        action="Get app"
        onAction={() => navigate(`/discover?app=${encodeURIComponent(app.id)}`)}
      />
    );
  if (!personalConsent) {
    return (
      <RuntimeState
        icon={Store}
        app={app}
        title={discoverAppName(app)}
        description="Review and agree to the permissions to start using this app."
        action="Review permissions"
        onAction={() => {
          const route = `/discover?app=${encodeURIComponent(app.id)}&review=permissions`;
          if (props.tab) {
            const surface = workspaceSurfaceFromRoute(route);
            if (surface) useWorkspaceStore.getState().openSurface({ ...surface, route });
          } else navigate(route);
        }}
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
    import.meta.env.DEV && !!import.meta.env.VITE_MISTY_APPS_DIRECTORY
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
  app?: OfficialApp;
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
        {props.app ? (
          <h1 className="text-lg font-semibold text-cream-bright">{props.title}</h1>
        ) : (
          <>
            <Icon
              className="mx-auto text-cream-muted"
              size={24}
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <h1 className="mt-4 text-lg font-semibold text-cream-bright">{props.title}</h1>
          </>
        )}
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
