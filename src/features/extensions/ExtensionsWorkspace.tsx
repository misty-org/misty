import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Menu } from "lucide-react";
import {
  Button,
  CollectionHeading,
  CollectionPage,
  CollectionSearch,
  IconButton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui";
import { resolveSetting, useSettingsProfiles } from "@/features/settings";
import { defaultCategories, withCategoryIcons } from "./extensionCategories";
import { ExtensionDetail } from "./ExtensionDetail";
import { InstallReviewDialog, UninstallDialog } from "./ExtensionDialogs";
import { ExtensionsCollection } from "./ExtensionsCollection";
import { ExtensionsRail } from "./ExtensionsRail";
import { extensionsNative } from "./native";
import {
  install,
  parseInstallations,
  pinIds,
  setPreference,
  updateInstallation,
  useExtensionsStore,
} from "./store";
import type { CatalogEntry, CatalogPage, ExtensionReview, Installation } from "./types";

export function ExtensionsWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const profile = useSettingsProfiles((s) => s.state);
  const ready = useSettingsProfiles((s) => s.ready);
  const account = useSettingsProfiles((s) => s.accountId);
  const runtime = useExtensionsStore();
  const [categories, setCategories] = useState(defaultCategories);
  useEffect(() => {
    if (!runtime.supported) return;
    let current = true;
    void extensionsNative
      .categories()
      .then((categories) => {
        if (current) setCategories(withCategoryIcons(categories));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [runtime.supported]);
  const raw = profile ? String(resolveSetting(profile, "extensions.installations").value) : "[]";
  const installed = parseInstallations(raw).filter((item) => item.installed);
  const view =
    profile && resolveSetting(profile, "extensions.view").value === "grid" ? "grid" : "list";
  const agentAccess = profile
    ? Boolean(resolveSetting(profile, "extensions.agent_access").value)
    : true;
  const params = new URLSearchParams(location.search);
  const category = params.get("category");
  const inInstalled = location.pathname === "/extensions/installed";
  const detailId = /^\/extensions\/addon\/(\d+)$/.exec(location.pathname)?.[1];
  const collectionRoute = useRef<string | null>(null);
  useEffect(() => {
    if (!detailId)
      collectionRoute.current = `${location.pathname}${location.search}${location.hash}`;
  }, [detailId, location.pathname, location.search, location.hash]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recommended");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<CatalogPage | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ExtensionReview | null>(null);
  const [privateAccess, setPrivateAccess] = useState(true);
  const [removing, setRemoving] = useState<Installation | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const host = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!host.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([value]) => setNarrow(value.contentRect.width < 760));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setPage(1);
  }, [query, sort, category]);
  useEffect(() => {
    if (inInstalled || !runtime.supported) return;
    let current = true;
    setLoading(true);
    setFailure("");
    setEntry(null);
    const timer = window.setTimeout(
      () => {
        const request = detailId
          ? extensionsNative.detail(Number(detailId)).then((value) => {
              if (current) setEntry(value);
            })
          : extensionsNative.search(query, category, page, sort).then((value) => {
              if (current) setCatalog(value);
            });
        void request
          .catch((error) => {
            if (current) setFailure(String(error));
          })
          .finally(() => {
            if (current) setLoading(false);
          });
      },
      query && !detailId ? 250 : 0,
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [inInstalled, detailId, query, category, page, sort, retry, runtime.supported]);
  async function work(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure("");
    try {
      await action();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function prepare(id: number) {
    await work(async () => {
      const review = await extensionsNative.prepare(id);
      setPrivateAccess(review.privateAllowed);
      setReview(review);
    });
  }
  function go(route: string) {
    navigate(route);
    setNavOpen(false);
  }
  const rail = (
    <ExtensionsRail
      categories={categories}
      category={category}
      inInstalled={inInstalled}
      detailId={detailId}
      go={go}
    />
  );
  const selected = installed.find((i) => i.id === Number(detailId));
  const local = runtime.states.find((s) => s.id === selected?.id);
  const detail = entry ?? local?.review?.entry;
  const title = detailId
    ? (detail?.name ?? "Extension")
    : inInstalled
      ? "Installed"
      : (categories.find((c) => c.id === category)?.name ?? "Discover");
  const items = inInstalled
    ? installed.filter(
        (i) =>
          i.name.toLowerCase().includes(query.toLowerCase()) &&
          (filter === "all" ||
            (filter === "enabled" && i.enabled) ||
            (filter === "disabled" && !i.enabled) ||
            (filter === "attention" &&
              runtime.states.some((s) => s.id === i.id && s.status.startsWith("needs-")))),
      )
    : (catalog?.entries ?? []);

  return (
    <section ref={host} className="flex h-full min-h-0 min-w-0 bg-charcoal-bg">
      {!narrow && rail}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {narrow && (
          <div className="px-4 pt-3">
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetTrigger asChild>
                <IconButton label="Extensions navigation">
                  <Menu size={18} />
                </IconButton>
              </SheetTrigger>
              <SheetContent side="left" className="w-56 p-0">
                <SheetTitle className="sr-only">Extensions navigation</SheetTitle>
                <SheetDescription className="sr-only">
                  Discover and manage browser extensions.
                </SheetDescription>
                {rail}
              </SheetContent>
            </Sheet>
          </div>
        )}
        <CollectionPage className="pt-5 pb-6">
          {detailId ? (
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2.5"
                onClick={() =>
                  go(
                    collectionRoute.current ?? (selected ? "/extensions/installed" : "/extensions"),
                  )
                }
              >
                <ArrowLeft size={16} />
                Back
              </Button>
            </div>
          ) : (
            <CollectionHeading
              title={title}
              actions={
                <CollectionSearch
                  aria-label={
                    inInstalled ? "Search installed extensions" : "Search Firefox Add-ons"
                  }
                  placeholder={inInstalled ? "Search installed" : "Search Firefox Add-ons"}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              }
            />
          )}
          {!runtime.supported && runtime.ready && (
            <p role="status" className="text-sm text-cream-muted">
              Extension installation requires the Misty desktop app on macOS 15.4 or later.
            </p>
          )}
          {!account && (
            <p className="text-sm text-cream-muted">
              Sign in to install extensions and sync them across your devices.
            </p>
          )}
          {(failure || runtime.error) && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 text-sm text-cream-muted"
            >
              <p>{failure || runtime.error}</p>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  useExtensionsStore.setState({ error: "" });
                  setRetry((v) => v + 1);
                }}
              >
                Retry
              </Button>
            </div>
          )}
          {detailId ? (
            <ExtensionDetail
              detail={detail}
              pending={!runtime.ready || loading}
              selected={selected}
              local={local}
              busy={busy}
              ready={ready}
              supported={runtime.supported}
              work={work}
              prepare={(id) => void prepare(id)}
              onUninstall={setRemoving}
            />
          ) : (
            <ExtensionsCollection
              inInstalled={inInstalled}
              view={view}
              filter={filter}
              sort={sort}
              query={query}
              items={items}
              installed={installed}
              states={runtime.states}
              catalog={catalog}
              page={page}
              loading={loading}
              busy={busy}
              ready={ready}
              runtimeReady={runtime.ready}
              supported={runtime.supported}
              agentAccess={agentAccess}
              onFilter={setFilter}
              onSort={setSort}
              onPage={setPage}
              work={work}
              prepare={(id) => void prepare(id)}
              go={go}
            />
          )}
        </CollectionPage>
      </div>
      <InstallReviewDialog
        review={review}
        busy={busy}
        failure={failure}
        privateAccess={privateAccess}
        onPrivateAccess={setPrivateAccess}
        onClose={() => setReview(null)}
        onInstall={(review) =>
          void work(async () => {
            await install(review, privateAccess);
            setReview(null);
            go(`/extensions/addon/${review.entry.id}`);
          })
        }
      />
      <UninstallDialog
        removing={removing}
        busy={busy}
        onClose={() => setRemoving(null)}
        onUninstall={(removing) =>
          void work(async () => {
            await updateInstallation(removing.id, { installed: false, enabled: false });
            await setPreference(
              "pins",
              JSON.stringify(pinIds().filter((id) => id !== removing.id)),
            );
            setRemoving(null);
            go("/extensions/installed");
          })
        }
      />
    </section>
  );
}
