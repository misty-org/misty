import { ArrowRight, FileText, Sparkles, Play, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../AuthContext";
import { InstallerCard } from "../../components/InstallerCard";
import { LoggerPanel } from "../../components/LoggerPanel";
import { releases } from "../../data/releases";
import { usePluginsStore } from "../../store/usePluginsStore";
import { useSetupStore } from "../../store/useSetupStore";
import { posts } from "../../website/pages/Blog/data";
import { changelog } from "../../website/pages/Changelog/data";

export default function HomePage() {
  const location = useLocation();
  const {
    busy,
    installState,
    launchMisty,
    restartMisty,
    status,
    systemError,
  } = useSetupStore(
    useShallow((state) => ({
      busy: state.busy,
      installState: state.installState,
      launchMisty: state.launchMisty,
      restartMisty: state.restartMisty,
      status: state.status,
      systemError: state.systemError,
    })),
  );
  const hasInstallerEventError = useSetupStore((state) =>
    state.events.some((event) => event.source === "installer" && event.level === "error"),
  );
  const { user } = useAuth();
  const {
    loadPlugins,
    marketplacePluginCount,
    installedPluginCount,
    loading: pluginsLoading,
  } = usePluginsStore(
    useShallow((state) => ({
      loadPlugins: state.loadPlugins,
      marketplacePluginCount: state.marketplacePlugins.length,
      installedPluginCount: state.installedPlugins.length,
      loading: state.loading,
    })),
  );
  const currentUser = status?.current_user ?? user;

  useEffect(() => {
    if (
      !status ||
      marketplacePluginCount > 0 ||
      installedPluginCount > 0 ||
      pluginsLoading
    ) {
      return;
    }

    void loadPlugins(`${status.os}-${status.arch}`);
  }, [
    installedPluginCount,
    loadPlugins,
    marketplacePluginCount,
    pluginsLoading,
    status?.arch,
    status?.os,
  ]);

  if (!currentUser) {
    if (!status && !systemError) {
      return <HubHomeLoading />;
    }

    return (
      <Navigate replace state={{ from: location.pathname }} to="/hub/signin" />
    );
  }

  const ready = Boolean(status?.ready);
  const hasInstallerError =
    Boolean(systemError) ||
    installState === "error" ||
    hasInstallerEventError;
  const latestChangelog = changelog[0] ?? {
    version: releases[0].version,
    date: releases[0].date,
    summary: releases[0].summary,
    changes: releases[0].changes,
  };
  const latestPost = posts[0] ?? null;
  const topPanelClass =
    "flex h-[20rem] min-h-0 flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0a0d10]/95 p-6 shadow-2xl shadow-black/25";
  const bottomPanelClass =
    "flex min-h-0 flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0a0d10]/95 p-6 shadow-2xl shadow-black/25";

  return (
    <div className="mx-auto flex w-full max-w-300 flex-1 flex-col px-5 py-4">
      <div className="border-b border-white/[0.07] pb-4">
        <h1 className="text-[34px] font-semibold tracking-[-0.03em] text-text">
          Home
        </h1>
      </div>

      <section className="grid content-start grid-cols-2 gap-2">
        <div className={topPanelClass}>
          <InstallerCard className="h-full" embedded />
        </div>

        <div className={topPanelClass}>
          <LoggerPanel
            className="h-full flex-1"
            emptyLabel="No activity yet."
            fill
            source="all"
          />

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-text transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!ready || busy || hasInstallerError}
              onClick={() => void restartMisty()}
              type="button"
            >
              <RotateCcw className="h-4 w-4" />
              Restart
            </button>

            <button
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!ready || busy || hasInstallerError}
              onClick={() => void launchMisty()}
              type="button"
            >
              <Play className="h-4 w-4" />
              Launch Misty
            </button>
          </div>
        </div>

        <div className={bottomPanelClass}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-text-muted">
              <Sparkles className="h-3.5 w-3.5" />
              LATEST NEWS
            </div>
            {latestPost ? (
              <Link
                className="inline-flex items-center gap-2 text-sm font-medium text-text-muted transition hover:text-text"
                to="/hub/resources/changelog"
              >
                Open resources
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </div>

          {latestPost ? (
            <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-white/[0.07] pt-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                  {latestPost.tag}
                </span>
                <span className="text-xs text-text-muted">
                  {latestPost.date}
                </span>
              </div>
              <h2 className="mt-4 text-xl font-semibold text-text">
                {latestPost.title}
              </h2>
              <p className="mt-3 text-sm leading-7 text-text-muted">
                {latestPost.summary}
              </p>
            </div>
          ) : (
            <div className="mt-5 rounded-3xl border border-dashed border-white/10 px-5 py-10 text-sm text-text-muted">
              No news published yet.
            </div>
          )}
        </div>

        <div className={bottomPanelClass}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-text-muted">
              <FileText className="h-3.5 w-3.5" />
              CHANGELOG
            </div>
            <Link
              className="inline-flex items-center gap-2 text-sm font-medium text-text-muted transition hover:text-text"
              to="/hub/resources/changelog"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-white/[0.07] pt-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {latestChangelog.version}
              </span>
              <span className="text-xs text-text-muted">
                {latestChangelog.date}
              </span>
            </div>
            <h2 className="mt-4 text-xl font-semibold text-text">
              {latestChangelog.summary}
            </h2>
            <div className="mt-4 grid gap-2">
              {latestChangelog.changes.slice(0, 3).map((change) => (
                <p key={change} className="text-sm leading-7 text-text-muted">
                  {change}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function HubHomeLoading() {
  const skeletonBlockClass = "misty-skeleton rounded-md";
  return (
    <div className="mx-auto flex w-full max-w-300 flex-1 flex-col px-5 py-4">
      <div className="border-b border-white/[0.07] pb-4">
        <h1 className="text-[34px] font-semibold tracking-[-0.03em] text-text">
          Home
        </h1>
      </div>

      <section className="grid content-start grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((index) => (
          <div
            className="flex h-[20rem] min-h-0 flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0a0d10]/95 p-6 shadow-2xl shadow-black/25"
            key={index}
          >
            <div className={`${skeletonBlockClass} h-5 w-32`} />
            <div className="mt-8 grid gap-3">
              <div className={`${skeletonBlockClass} h-4 w-3/4`} />
              <div className={`${skeletonBlockClass} h-4 w-1/2`} />
              <div className={`${skeletonBlockClass} h-4 w-2/3`} />
            </div>
            <div className="mt-auto text-sm text-text-muted">
              Checking Misty Hub status...
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
