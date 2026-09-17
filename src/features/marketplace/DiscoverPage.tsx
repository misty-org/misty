import { useAuth } from "@/features/auth";
import { officialAppRoute, useAppsStore } from "@/features/apps";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { DiscoverBrowser } from "./components/DiscoverBrowser";

export function DiscoverPage({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [embeddedReview, setEmbeddedReview] = useState(false);
  const requestedAppId = searchParams.get("app") ?? "";

  useEffect(() => {
    if (user?.id) void load(user.id);
  }, [load, user?.id]);

  // A Discover pane keeps its local selection independent of other workspace tabs.
  useEffect(() => {
    if (embedded && requestedAppId) {
      setEmbeddedAppId(requestedAppId);
      setEmbeddedReview(searchParams.get("review") === "permissions");
    }
  }, [embedded, requestedAppId, location.key, searchParams]);

  const selectApp = (id: string) => {
    if (embedded) {
      setEmbeddedAppId(id);
      setEmbeddedReview(false);
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("review");
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
        catalog={catalog.filter(app=>app.id!=="agents")}
        installations={installations}
        loading={loading}
        ready={ready}
        error={error}
        actionAppId={actionAppId}
        mobile={isNativeMobileBuild}
        selectedAppId={embedded ? embeddedAppId : requestedAppId}
        reviewPermissions={embedded ? embeddedReview : searchParams.get("review") === "permissions"}
        requestKey={location.key}
        requestedSection={searchParams.get("section") === "installed" ? "installed" : undefined}
        onSelect={selectApp}
        onRefresh={() => {
          if (user?.id) void load(user.id, true);
        }}
        onInstall={add}
        onOpen={(app) => navigate(officialAppRoute(app.id, undefined, user?.id ?? ""))}
        onRemove={(app) => remove(app.id)}
      />
    </>
  );
}
