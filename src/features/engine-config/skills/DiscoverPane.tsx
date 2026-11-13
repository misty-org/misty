// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Discover: repository discovery (an explicit scan), skills.sh search, the popular list and the
 * repository list. Online requests happen only from what the person does on this pane.
 */
import { Download, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Button,
  ChoiceGroup,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ListRow,
  SearchField,
  SkeletonList,
  Text,
} from "@/shared/ui";
import {
  EmptyLine,
  FeedbackLine,
  InlineError,
  SkillListSkeleton,
  type Feedback,
} from "./components";
import { SkillDiscoverDialog } from "./SkillDiscoverDialog";
import { t } from "./strings";
import type { DiscoveredSkill, SkillRepo } from "./types";
import { useSkillDiscovery } from "./useSkillDiscovery";

type BrowseMode = "popular" | "repos";

function DiscoverRow({
  skill,
  busy,
  installed,
  onOpen,
  onInstall,
}: {
  skill: DiscoveredSkill;
  busy: boolean;
  installed: boolean;
  onOpen: () => void;
  onInstall: () => void;
}) {
  // The row opens the details: skills.sh gives only name / repo / installs, and what a skill
  // does is in its SKILL.md. Install stays at the row's end. A row has one muted line, so the
  // description, the repository and the installs share it.
  const details = [
    skill.description,
    `${skill.repoOwner}/${skill.repoName}`,
    typeof skill.installs === "number" ? t("discover.installs", { count: skill.installs }) : "",
  ].filter(Boolean);
  return (
    // ListRow is a div; the list item around it keeps the list a list.
    <li className="list-none">
      <ListRow
        label={skill.name}
        description={details.join(" · ")}
        aria-label={t("discover.open", { name: skill.name })}
        className="gap-2"
        onOpen={onOpen}
        trailing={
          <Button size="sm" icon={Download} loading={busy} disabled={installed} onClick={onInstall}>
            {installed ? t("discover.installed") : t("discover.install")}
          </Button>
        }
      />
    </li>
  );
}

/** The search field with Search and Refresh. */
function DiscoverSearchBar({
  query,
  onQueryChange,
  busy,
  onSearch,
  refreshing,
  onRefresh,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  busy: boolean;
  onSearch: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <SearchField
        containerClassName="flex-1"
        aria-label={t("discover.searchPlaceholder")}
        placeholder={t("discover.searchPlaceholder")}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          // Enter while an IME is composing confirms a candidate; it isn't a search.
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") onSearch();
        }}
      />
      <Button disabled={busy} onClick={onSearch}>
        {t("discover.search")}
      </Button>
      <Button icon={RefreshCw} loading={refreshing} disabled={busy} onClick={onRefresh}>
        {t("common.refresh")}
      </Button>
    </div>
  );
}

/** Popular or repositories, the repository list, and the explicit repository scan. */
function BrowseModeBar({
  mode,
  onModeChange,
  onManageRepos,
  onScan,
  scanning,
}: {
  mode: BrowseMode;
  onModeChange: (mode: BrowseMode) => void;
  onManageRepos: () => void;
  onScan: () => void;
  scanning: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <ChoiceGroup
        label="Browse"
        value={mode}
        onChange={onModeChange}
        options={[
          { value: "popular", label: t("discover.popular") },
          { value: "repos", label: t("discover.repos") },
        ]}
      />
      <span className="flex-1" />
      <Button size="sm" onClick={onManageRepos}>
        {t("discover.manageRepos")}
      </Button>
      {mode === "repos" ? (
        <Button icon={RefreshCw} loading={scanning} onClick={onScan}>
          {t("discover.scan")}
        </Button>
      ) : null}
    </div>
  );
}

/** The search result count and Back to browse. */
function SearchSummaryBar({ totalCount, onClear }: { totalCount: number; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Text bare as="p" tone="muted" className="text-xs">
        {t("discover.resultCount", { count: totalCount })}
      </Text>
      <Button size="sm" onClick={onClear}>
        {t("discover.clearSearch")}
      </Button>
    </div>
  );
}

/** What the list shows: the popular ranking or the configured repositories. */
function DiscoverHint({
  mode,
  repoCount,
  cached,
}: {
  mode: BrowseMode;
  repoCount: number;
  cached: boolean;
}) {
  return (
    <Text bare as="p" tone="muted" className="text-xs">
      {mode === "popular"
        ? t("discover.popularHint")
        : t("discover.reposHint", { count: repoCount })}
      {cached ? ` · ${t("discover.cached")}` : ""}
    </Text>
  );
}

/** The list, its first-load skeleton or its empty state. */
function DiscoverResults({
  listed,
  busy,
  isSearch,
  installingKey,
  installedKeys,
  onOpen,
  onInstall,
}: {
  listed: DiscoveredSkill[];
  busy: boolean;
  isSearch: boolean;
  installingKey: string | null;
  installedKeys: ReadonlySet<string>;
  onOpen: (skill: DiscoveredSkill) => void;
  onInstall: (skill: DiscoveredSkill) => void;
}) {
  if (busy && listed.length === 0) {
    return <SkillListSkeleton label="Skills" rows={5} trailing="button-sm" />;
  }
  if (listed.length === 0) {
    return <EmptyLine text={isSearch ? t("discover.noResults") : t("discover.none")} />;
  }
  return (
    <ul className="-mx-2 flex flex-col gap-0.5">
      {listed.map((skill) => (
        <DiscoverRow
          key={skill.key}
          skill={skill}
          busy={installingKey === skill.key}
          installed={installedKeys.has(skill.key)}
          onOpen={() => onOpen(skill)}
          onInstall={() => onInstall(skill)}
        />
      ))}
    </ul>
  );
}

export function DiscoverPane() {
  const discovery = useSkillDiscovery(true);
  const [mode, setMode] = useState<BrowseMode>("popular");
  /** Keys installed from this pane (this visit only): the row turns to Installed instead of
   *  inviting a second install. My skills refreshes its whole list itself. */
  const [installedKeys, setInstalledKeys] = useState<ReadonlySet<string>>(new Set());
  /** The entry whose details are open: found in the current list, so a new search or mode closes it. */
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [reposOpen, setReposOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);

  const flash = (next: Feedback, ttlMs = 4000) => {
    setFeedback(next);
    if (ttlMs > 0) {
      window.setTimeout(() => {
        setFeedback((current) => (current === next ? null : current));
      }, ttlMs);
    }
  };

  const install = async (skill: DiscoveredSkill) => {
    try {
      await discovery.install(skill, ["claude", "codex"]);
      setInstalledKeys((previous) => new Set(previous).add(skill.key));
      flash({ tone: "success", text: t("feedback.installed", { name: skill.name }) });
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const listed = discovery.searchResults ?? discovery.discover;
  const isSearch = discovery.searchResults !== null;
  const busy = discovery.searchLoading || discovery.discoverLoading;
  const error = isSearch ? discovery.searchError : discovery.discoverError;
  const detailSkill = useMemo(
    () => listed.find((skill) => skill.key === detailKey) ?? null,
    [listed, detailKey],
  );

  const runSearch = () => {
    const trimmed = discovery.query.trim();
    if (trimmed.length < 2) {
      flash({ tone: "error", text: t("discover.searchHint") });
      return;
    }
    void discovery.runSearch(trimmed);
  };

  const track = (setBusy: (value: boolean) => void, work: () => Promise<void>) => {
    setBusy(true);
    void work()
      .catch((err: unknown) =>
        flash({ tone: "error", text: err instanceof Error ? err.message : String(err) }, 0),
      )
      .finally(() => setBusy(false));
  };

  const refresh = () => {
    if (refreshing) return;
    track(setRefreshing, () =>
      isSearch
        ? discovery.runSearch(discovery.query.trim())
        : mode === "popular"
          ? discovery.loadPopular(true)
          : discovery.loadDiscover(true),
    );
  };

  const scan = () => {
    if (scanning) return;
    track(setScanning, () => discovery.loadDiscover(true));
  };

  const changeMode = (next: BrowseMode) => {
    setMode(next);
    void (next === "popular" ? discovery.loadPopular(false) : discovery.loadDiscover(false));
  };

  // Back to the list the browse view was on before the search.
  const clearSearch = () => {
    discovery.setQuery("");
    void (mode === "popular" ? discovery.loadPopular(false) : discovery.loadDiscover(false));
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <DiscoverSearchBar
        query={discovery.query}
        onQueryChange={discovery.setQuery}
        busy={busy}
        onSearch={runSearch}
        refreshing={refreshing}
        onRefresh={refresh}
      />

      {isSearch ? (
        <SearchSummaryBar totalCount={discovery.totalCount} onClear={clearSearch} />
      ) : (
        <BrowseModeBar
          mode={mode}
          onModeChange={changeMode}
          onManageRepos={() => setReposOpen(true)}
          onScan={scan}
          scanning={scanning || discovery.discoverLoading}
        />
      )}

      {isSearch ? null : (
        <DiscoverHint
          mode={mode}
          repoCount={discovery.repos.length}
          cached={discovery.discoverCached}
        />
      )}

      <FeedbackLine feedback={feedback} />
      {error ? <InlineError message={error} /> : null}

      <DiscoverResults
        listed={listed}
        busy={busy}
        isSearch={isSearch}
        installingKey={discovery.installingKey}
        installedKeys={installedKeys}
        onOpen={(skill) => setDetailKey(skill.key)}
        onInstall={(skill) => void install(skill)}
      />

      {detailSkill ? (
        <SkillDiscoverDialog
          skill={detailSkill}
          installed={installedKeys.has(detailSkill.key)}
          busy={discovery.installingKey === detailSkill.key}
          onInstall={() => void install(detailSkill)}
          onClose={() => setDetailKey(null)}
        />
      ) : null}

      {reposOpen ? (
        <RepoDialog
          repos={discovery.repos}
          loading={discovery.reposLoading}
          onClose={() => setReposOpen(false)}
          onAdd={(repo) => discovery.addRepo(repo)}
          onRemove={(owner, name) => discovery.removeRepo(owner, name)}
        />
      ) : null}
    </div>
  );
}

function RepoDialog({
  repos,
  loading,
  onClose,
  onAdd,
  onRemove,
}: {
  repos: SkillRepo[];
  loading: boolean;
  onClose: () => void;
  onAdd: (repo: { owner: string; name: string; branch: string }) => Promise<void>;
  onRemove: (owner: string, name: string) => Promise<void>;
}) {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAdd({ owner: owner.trim(), name: name.trim(), branch: branch.trim() || "main" });
      setOwner("");
      setName("");
      setBranch("main");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = (repo: SkillRepo) => {
    setError(null);
    void onRemove(repo.owner, repo.name).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-120">
        <DialogHeader>
          <DialogTitle>{t("repos.title")}</DialogTitle>
        </DialogHeader>
        {loading ? (
          // The list's own rows: 36px, a hairline between them, Remove at the end.
          <SkeletonList
            label={t("repos.title")}
            rows={3}
            trailing="button-sm"
            className="gap-0 divide-y"
            rowClassName="min-h-9 py-1.5"
          />
        ) : (
          <ul className="flex max-h-48 flex-col overflow-y-auto">
            {repos.map((repo) => (
              <li
                key={`${repo.owner}/${repo.name}`}
                className="flex items-center justify-between gap-2 border-t py-1.5 first:border-t-0"
              >
                <Text full tone="default" className="text-sm">
                  {repo.owner}/{repo.name}
                  <Text bare tone="muted" className="ml-1">
                    @{repo.branch}
                  </Text>
                </Text>
                <Button size="sm" onClick={() => remove(repo)}>
                  {t("repos.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-[1fr_1fr_6rem] gap-2">
          {(
            [
              ["owner", owner, setOwner],
              ["name", name, setName],
              ["branch", branch, setBranch],
            ] as const
          ).map(([key, value, set]) => (
            <div key={key} className="grid gap-1.5">
              <Label htmlFor={`skill-repo-${key}`}>{t(`repos.${key}`)}</Label>
              <Input
                id={`skill-repo-${key}`}
                value={value}
                onChange={(event) => set(event.target.value)}
              />
            </div>
          ))}
        </div>
        {error ? (
          <Text bare as="p" role="alert" tone="bright" className="text-xs">
            {error}
          </Text>
        ) : null}
        <DialogFooter className="gap-2">
          <Button size="lg" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            size="lg"
            variant="primary"
            loading={busy}
            disabled={!owner.trim() || !name.trim()}
            onClick={() => void add()}
          >
            {t("repos.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
