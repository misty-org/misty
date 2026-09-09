import { useAuth } from "@/features/auth";
import { officialAppRoute, useAppsStore } from "@/features/apps";
import { preferredDefaultSpace, useSpacesStore } from "@/features/spaces";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { DiscoverBrowser } from "./components/DiscoverBrowser";

export function DiscoverPage({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
  const activeSpace = preferredDefaultSpace(spaces);
  const requestedAppId = searchParams.get("app") ?? "";

  useEffect(() => {
    if (user?.id) void load(user.id);
  }, [load, user?.id]);

  // A Discover pane keeps its local selection independent of other workspace tabs.
  useEffect(() => {
    if (embedded && requestedAppId) setEmbeddedAppId(requestedAppId);
  }, [embedded, requestedAppId, location.key]);

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
        requestKey={location.key}
        requestedSection={searchParams.get("section") === "installed" ? "installed" : undefined}
        onSelect={selectApp}
        onRefresh={() => {
          if (user?.id) void load(user.id, true);
        }}
        onInstall={add}
        onOpen={(app) => navigate(officialAppRoute(app.id, activeSpace?.id, user?.id ?? ""))}
        onRemove={(app) => remove(app.id)}
      />
    </>
  );
}
