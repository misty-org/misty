import type { OfficialApp } from "@/api/apps";
import { useAuth } from "@/features/auth";
import { officialAppRoute, useAppsStore } from "@/features/apps";
import { preferredDefaultSpace, useSpacesStore } from "@/features/spaces";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DiscoverBrowser } from "./components/DiscoverBrowser";
import { OfficialAppReviewDialogs } from "./components/OfficialAppReviewDialogs";

export function DiscoverPage({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const spaces = useSpacesStore((state) => state.spaces);
  const catalog = useAppsStore((state) => state.catalog);
  const installations = useAppsStore((state) => state.installations);
  const loading = useAppsStore((state) => state.loading);
  const ready = useAppsStore((state) => state.ready);
  const error = useAppsStore((state) => state.error);
  const actionAppId = useAppsStore((state) => state.actionAppId);
  const load = useAppsStore((state) => state.load);
  const add = useAppsStore((state) => state.install);
  const remove = useAppsStore((state) => state.uninstall);
  const [embeddedAppId, setEmbeddedAppId] = useState("");
  const [removing, setRemoving] = useState<OfficialApp | null>(null);
  const activeSpace = preferredDefaultSpace(spaces);
  const requestedAppId = searchParams.get("app") ?? "";

  useEffect(() => {
    if (user?.id) void load(user.id);
  }, [load, user?.id]);

  // A Discover pane keeps its local selection independent of other workspace tabs.
  useEffect(() => {
    if (embedded && requestedAppId) setEmbeddedAppId(requestedAppId);
  }, [embedded, requestedAppId]);

  const selectApp = (id: string) => {
    if (embedded) {
      setEmbeddedAppId(id);
      return;
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("app", id);
        else next.delete("app");
        return next;
      },
      { replace: true },
    );
  };

  return (
    <>
      <DiscoverBrowser
        catalog={catalog}
        installations={installations}
        loading={loading}
        ready={ready}
        error={error}
        actionAppId={actionAppId}
        mobile={isNativeMobileBuild}
        selectedAppId={embedded ? embeddedAppId : requestedAppId}
        onSelect={selectApp}
        onRefresh={() => {
          if (user?.id) void load(user.id, true);
        }}
        onInstall={(app) => void add(app).catch(() => undefined)}
        onOpen={(app) => navigate(officialAppRoute(app.id, activeSpace?.id, user?.id ?? ""))}
        onRemove={setRemoving}
      />
      <OfficialAppReviewDialogs
        installApp={null}
        uninstallApp={removing}
        onCloseInstall={() => undefined}
        onCloseUninstall={() => setRemoving(null)}
        onInstall={() => undefined}
        onUninstall={(app) => {
          setRemoving(null);
          void remove(app.id).catch(() => undefined);
        }}
      />
    </>
  );
}
