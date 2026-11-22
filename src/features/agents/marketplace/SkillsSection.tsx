import {
  ChartColumn,
  ExternalLink,
  FolderGit2,
  FolderInput,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  createInstalledPaneActions,
  SkillConfirmDialog,
  SkillImportDialog,
  SkillReposDialog,
  skillsHubApi,
  skillsText as t,
  SkillUsagePane,
  usageForSkill,
  useInstalledSkills,
  useSkillUsage,
  type BusyTarget,
  type ConfirmState,
  type Feedback,
  type SkillRow,
  type SkillTargetId,
  type UpdateMap,
} from "@/features/engine-config/skills";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  CatalogDone,
  CollectionControls,
  EmptyState,
  ErrorState,
  IconButton,
  MenuItem,
  notify,
  ShelfItem,
  useConfirmDelete,
} from "@misty/ui";
import { openAgentsHub } from "../hub/agentsHubStore";
import { failureText, skillTargetOf } from "./api";
import { EnginePicker, MarketShelf, MarketShelvesSkeleton, MarketSkeleton } from "./MarketShelf";
import { useMarketEngines } from "./marketView";
import { entryMatches, skillEntries, useSkillCatalog, type SkillEntry } from "./skillCatalog";
import { SkillStoreDetail } from "./SkillStoreDetail";

/** How long the trash keeps an uninstalled skill (native `skills` trash): Undo lasts as long. */
const TRASH_KEEPS_MS = 5 * 60 * 1000;

type SkillsTab = "all" | "usage";

/**
 * Explore's Skills: Agent Skills for one engine, from the skills hub, which keeps one copy of each
 * skill and syncs it into each engine's own skills folder. The control row picks the engine, the
 * catalog or Claude Code's usage, and holds Check for updates, Import and the hub's repositories.
 * The shelves are what the engine has, then each repository's skills (skills.sh as the person
 * types), then skills only other engines have. The rail's search arrives as `query`.
 */
export function SkillsSection({ query }: { query: string }) {
  const { engines, engine, name, error, reload, pick } = useMarketEngines("skills", (id) =>
    Boolean(skillTargetOf(id)),
  );
  const target = skillTargetOf(engine);
  if (!engines)
    return error ? (
      <ErrorState
        inline
        title="The engines couldn't be listed"
        line={error}
        action={{ label: "Try again", icon: RefreshCw, onClick: reload }}
      />
    ) : (
      <MarketSkeleton label="Skills" logos={false} />
    );
  if (!engines.length || !target)
    return (
      <EmptyState
        inline
        title="Nothing takes skills yet"
        line="Install an engine, and its skills show here."
        action={{ label: "Open CLIs", onClick: () => openAgentsHub("clis") }}
      />
    );
  return (
    <EngineSkillShelves
      key={target}
      target={target}
      name={name}
      query={query}
      picker={<EnginePicker engines={engines} engine={engine} onPick={pick} />}
    />
  );
}

function EngineSkillShelves({
  target,
  name,
  query,
  picker,
}: {
  target: SkillTargetId;
  name: string;
  query: string;
  picker: ReactNode;
}) {
  const store = useInstalledSkills(true);
  const catalog = useSkillCatalog(query);
  const [tab, setTab] = useState<SkillsTab>("all");
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const [busyTarget, setBusyTarget] = useState<BusyTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reposOpen, setReposOpen] = useState(false);
  const [pendingConfirm, setConfirm] = useState<ConfirmState | null>(null);
  const [updates, setUpdates] = useState<UpdateMap>({});
  const [checking, setChecking] = useState(false);
  const { confirm, dialog } = useConfirmDelete();

  const all = useMemo(
    () => skillEntries(catalog.found ?? [], store.skills),
    [catalog.found, store.skills],
  );
  const opened = all.find((entry) => entry.key === openedKey) ?? null;
  const usageStore = useSkillUsage(Boolean(opened?.row));
  const targetLabel = (id: string) => store.targets.find((info) => info.id === id)?.label ?? id;

  // The hub's actions, as its own page runs them; what they report shows as a notice, and an
  // uninstall's notice offers Undo while the trash keeps it.
  const restoreId = useRef<string | null>(null);
  const undo = (id: string) =>
    void store.restore(id).then(
      () => notify({ message: t("feedback.restored") }),
      (reason: unknown) =>
        notify({ message: failureText(reason, "The skill couldn't be restored."), tone: "error" }),
    );
  const flash = (feedback: Feedback) => {
    if (!feedback || feedback.tone === "pending") return;
    const trashed = restoreId.current;
    restoreId.current = null;
    notify({
      message: feedback.text,
      tone: feedback.tone === "error" ? "error" : "neutral",
      action: trashed
        ? { label: t("feedback.restoreNow"), onSelect: () => undo(trashed) }
        : undefined,
      // Undo lasts as long as the trash keeps the skill.
      duration: trashed ? TRASH_KEEPS_MS : undefined,
    });
  };
  const actions = createInstalledPaneActions({
    store,
    flash,
    targetLabel,
    selectedId: opened?.row?.id ?? null,
    setSelectedId: (id) => {
      if (id === null) setOpenedKey(null);
    },
    setUpdates,
    setConfirm,
    setBusyTarget,
    setRestoreId: (id) => {
      restoreId.current = id;
    },
    setImportOpen,
  });

  const pendingFor = (entry: SkillEntry) =>
    entry.row
      ? store.pendingIds.has(entry.row.id) ||
        store.pendingIds.has(entry.row.directory) ||
        busyTarget?.skillId === entry.row.id
      : store.pendingIds.has(entry.key);

  const install = async (entry: SkillEntry) => {
    if (entry.row) return actions.onToggleTarget(entry.row, target, true);
    const skill = entry.found;
    if (!skill) return;
    try {
      await store.runMutation(entry.key, () => skillsHubApi.install(skill, [target]));
      notify({ message: t("feedback.installed", { name: entry.name }) });
    } catch (reason) {
      notify({
        message: failureText(reason, `${entry.name} couldn't be installed.`),
        tone: "error",
      });
    }
  };

  /** Takes the skill out of this engine; the last engine's copy goes with the hub's own. */
  const removeHere = (row: SkillRow) => {
    if (!row.targets.some((id) => id !== target)) {
      setConfirm({ kind: "uninstall", skill: row });
      return;
    }
    void confirm({
      title: `Remove ${row.name} from ${name}?`,
      what: "Other engines that use it keep it.",
      confirmLabel: "Remove",
      onConfirm: () => actions.onToggleTarget(row, target, false),
    });
  };

  const checkForUpdates = () => {
    if (checking) return;
    setChecking(true);
    catalog.reload();
    void actions
      .handleRefresh()
      .catch((reason: unknown) =>
        notify({ message: failureText(reason, "Updates couldn't be checked."), tone: "error" }),
      )
      .finally(() => setChecking(false));
  };

  const menuFor = (entry: SkillEntry) => {
    const row = entry.row;
    const state = row?.targetStates?.[target] ?? "off";
    const editable = Boolean(row && !row.readonly);
    const items = [
      entry.link ? (
        <MenuItem
          key="open"
          icon={ExternalLink}
          label="Open its page"
          onSelect={() => openExternalLink(entry.link ?? "")}
        />
      ) : null,
      row && editable && row.managed && state !== "off" ? (
        <MenuItem
          key="here"
          icon={Trash2}
          label={`Remove from ${name}`}
          danger
          onSelect={() => removeHere(row)}
        />
      ) : null,
      row && editable && !row.managed ? (
        <MenuItem
          key="adopt"
          icon={FolderInput}
          label={t("actions.import")}
          onSelect={() => void actions.onImport(row)}
        />
      ) : null,
      row && editable ? (
        <MenuItem
          key="all"
          icon={Trash2}
          label={row.managed ? "Remove from every engine" : t("actions.deleteLocal")}
          danger
          onSelect={() =>
            setConfirm({ kind: row.managed ? "uninstall" : "deleteLocal", skill: row })
          }
        />
      ) : null,
    ].filter(Boolean);
    return items.length ? <>{items}</> : undefined;
  };

  const itemOf = (entry: SkillEntry) => {
    const row = entry.row;
    const state = row?.targetStates?.[target] ?? "off";
    const pending = pendingFor(entry);
    return (
      <ShelfItem
        key={entry.key}
        title={entry.name}
        line={state === "orphan" ? t("orphanHint") : entry.description || row?.directory}
        action={
          row && updates[row.id] ? (
            <Button
              variant="get"
              size="sm"
              disabled={pending}
              onClick={() => void actions.runUpdate(row, false)}
            >
              {t("actions.update")}
            </Button>
          ) : state === "synced" ? (
            <CatalogDone />
          ) : row?.readonly ? undefined : (
            <Button
              variant="get"
              size="sm"
              aria-label={`Install ${entry.name}`}
              disabled={pending}
              onClick={() => void install(entry)}
            >
              {state === "orphan" ? "Sync again" : "Install"}
            </Button>
          )
        }
        menu={menuFor(entry)}
        onOpen={() => setOpenedKey(entry.key)}
      />
    );
  };

  const matching = all.filter((entry) => entryMatches(entry, query) || entry.found);
  const here = matching.filter((entry) => (entry.row?.targetStates?.[target] ?? "off") !== "off");
  const elsewhere = catalog.found
    ? matching.filter(
        (entry) =>
          entry.row && !entry.found && (entry.row.targetStates?.[target] ?? "off") === "off",
      )
    : [];
  // Each repository is a shelf, in the order the catalog lists them.
  const shelves = new Map<string, SkillEntry[]>();
  for (const entry of matching)
    if (entry.found && entry.repo)
      shelves.set(entry.repo, [...(shelves.get(entry.repo) ?? []), entry]);

  const installedFirstLoad = store.loading && store.skills.length === 0;
  const nothing =
    !installedFirstLoad && catalog.found && !here.length && !elsewhere.length && !shelves.size;

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        {picker}
        <div className="min-w-0 flex-1">
          <CollectionControls
            utilities={
              <>
                <IconButton
                  label={t("tabs.usage")}
                  aria-pressed={tab === "usage"}
                  onClick={() => setTab(tab === "usage" ? "all" : "usage")}
                >
                  <ChartColumn />
                </IconButton>
                <IconButton label={t("refresh")} disabled={checking} onClick={checkForUpdates}>
                  <RefreshCw />
                </IconButton>
                <IconButton
                  label={t("actions.importLocal")}
                  disabled={store.loading}
                  onClick={() => setImportOpen(true)}
                >
                  <Plus />
                </IconButton>
                <IconButton label={t("discover.manageRepos")} onClick={() => setReposOpen(true)}>
                  <FolderGit2 />
                </IconButton>
              </>
            }
          />
        </div>
      </div>

      {tab === "usage" ? (
        <SkillUsagePane />
      ) : installedFirstLoad ? (
        <MarketShelvesSkeleton label={`${name} skills`} logos={false} />
      ) : store.error && !store.skills.length && !catalog.found?.length ? (
        <ErrorState
          inline
          title="The skills couldn't be listed"
          line={store.error}
          action={{
            label: "Try again",
            icon: RefreshCw,
            onClick: () => {
              catalog.reload();
              void store.refresh();
            },
          }}
        />
      ) : nothing ? (
        <EmptyState inline title="No skills found" line="Try other words." />
      ) : (
        <>
          {here.length ? (
            <MarketShelf
              key={`here:${query}`}
              title={`Installed in ${name}`}
              items={here}
              render={itemOf}
            />
          ) : null}
          {!catalog.found ? (
            <MarketShelvesSkeleton label={`${name} skills`} logos={false} />
          ) : catalog.error && !shelves.size ? (
            <ErrorState
              inline
              title="The skills couldn't be listed"
              line={catalog.error}
              action={{ label: "Try again", icon: RefreshCw, onClick: catalog.reload }}
            />
          ) : (
            [...shelves].map(([repo, items]) => (
              <MarketShelf key={`${repo}:${query}`} title={repo} items={items} render={itemOf} />
            ))
          )}
          {elsewhere.length ? (
            <MarketShelf
              key={`elsewhere:${query}`}
              title="In other engines"
              items={elsewhere}
              render={itemOf}
            />
          ) : null}
        </>
      )}

      <SkillStoreDetail
        entry={opened}
        target={target}
        engineName={name}
        targets={store.targets}
        pending={opened ? pendingFor(opened) : false}
        busyTarget={
          opened?.row && busyTarget?.skillId === opened.row.id ? busyTarget.targetId : null
        }
        usage={opened?.row ? usageForSkill(usageStore.usage, opened.row) : null}
        usageLoading={usageStore.usageLoading}
        usageError={usageStore.usageError}
        hasUpdate={Boolean(opened?.row && updates[opened.row.id])}
        onClose={() => setOpenedKey(null)}
        onInstall={(entry) => void install(entry)}
        onToggleTarget={(skill, id, enabled) => void actions.onToggleTarget(skill, id, enabled)}
        onUpdate={(skill) => void actions.runUpdate(skill, false)}
        onUninstall={(skill) => setConfirm({ kind: "uninstall", skill })}
        onDeleteLocal={(skill) => setConfirm({ kind: "deleteLocal", skill })}
        onImport={(skill) => void actions.onImport(skill)}
      />
      {importOpen ? (
        <SkillImportDialog
          targets={store.targets}
          busy={store.pendingIds.size > 0}
          onClose={() => setImportOpen(false)}
          onImport={(directory, ids) => void actions.onImportFromDialog(directory, ids)}
        />
      ) : null}
      {reposOpen ? (
        <SkillReposDialog
          onClose={() => {
            setReposOpen(false);
            catalog.reload();
          }}
        />
      ) : null}
      {pendingConfirm ? (
        <SkillConfirmDialog
          confirm={pendingConfirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => actions.handleConfirm(pendingConfirm)}
        />
      ) : null}
      {dialog}
    </>
  );
}
