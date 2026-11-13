// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * My skills: the installed list, local import, engine sync from the row or
 * the detail panel, updates and destructive confirmations.
 *
 * A row is a button that opens the detail panel; the engine icons next to it
 * are separate buttons, so opening the panel can never toggle a target by
 * accident and toggling one engine never opens the panel. Adopting a local
 * skill is deliberately not a row action: it lives in the detail panel and in
 * the target checkboxes, so the list keeps one action per row at most.
 *
 * The presentation is in `InstalledPane.parts.tsx`; this file keeps the state,
 * the actions and the composition.
 */
import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/shared/ui";
import { skillsHubApi } from "./api";
import { t } from "./strings";
import { FeedbackLine, type Feedback } from "./components";
import { SkillDetailDialog } from "./SkillDetailDialog";
import { SkillImportDialog } from "./SkillImportDialog";
import {
  EngineFilterChips,
  InstalledCountLine,
  InstalledListArea,
  InstalledToolbar,
  SkillConfirmDialog,
  type BusyTarget,
  type ConfirmState,
  type UpdateMap,
} from "./InstalledPane.parts";
import { useInstalledSkills, type InstalledSkillsStore } from "./useInstalledSkills";
import { useSkillUsage } from "./useSkillUsage";
import type { SkillRow, SkillTargetId } from "./types";
import {
  filterSkills,
  nextTargets,
  summarizeTargetResults,
  usageForSkill,
  visibleEngines,
} from "./utils";

interface PaneActionDeps {
  store: InstalledSkillsStore;
  flash: (feedback: Feedback, ttlMs?: number) => void;
  targetLabel: (targetId: string) => string;
  selectedId: string | null;
  setSelectedId: (value: string | null) => void;
  setUpdates: Dispatch<SetStateAction<UpdateMap>>;
  setConfirm: (value: ConfirmState | null) => void;
  setBusyTarget: Dispatch<SetStateAction<BusyTarget | null>>;
  setRestoreId: (value: string | null) => void;
  setImportOpen: (value: boolean) => void;
}

/** Every async action the pane can run, gathered in one factory so the
 *  component stays a composition of header / list / dialogs instead of one
 *  long function mixing state transitions with markup. */
function createInstalledPaneActions(deps: PaneActionDeps) {
  const {
    store,
    flash,
    targetLabel,
    selectedId,
    setSelectedId,
    setUpdates,
    setConfirm,
    setBusyTarget,
    setRestoreId,
    setImportOpen,
  } = deps;

  const reportTargetResults = (
    results: { target: string; ok: boolean; error: string | null }[] | undefined,
    name: string,
  ) => {
    const summary = summarizeTargetResults(results);
    if (summary.allOk) {
      flash({ tone: "success", text: t("feedback.syncedAll", { name }) });
      return;
    }
    const failed = summary.failed.map((entry) => targetLabel(entry.target)).join(", ");
    flash({ tone: "error", text: t("feedback.syncedPartial", { name, failed }) }, 0);
  };

  const handleRefresh = () => {
    return store.refresh().then(async () => {
      // Update signals ride the same refresh: one round trip for the user.
      const payload = await skillsHubApi.updates(false);
      setUpdates(payload.updates ?? {});
    });
  };

  const runUpdate = async (skill: SkillRow, force: boolean) => {
    if (!skill.repoOwner || !skill.repoName) return;
    try {
      await store.runMutation(skill.id, () =>
        skillsHubApi.install(
          {
            key: skill.key,
            name: skill.name,
            description: skill.description,
            directory: skill.sourceDirectory || skill.directory,
            readmeUrl: skill.readmeUrl,
            repoOwner: skill.repoOwner as string,
            repoName: skill.repoName as string,
            repoBranch: skill.repoBranch ?? "main",
          },
          (skill.targets.length > 0 ? skill.targets : ["claude", "codex"]) as SkillTargetId[],
          force,
        ),
      );
      setUpdates((previous) => ({ ...previous, [skill.id]: false }));
      flash({ tone: "success", text: t("feedback.updated", { name: skill.name }) });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "conflict" && !force) {
        setConfirm({ kind: "overwrite", skill });
        return;
      }
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const runUninstall = async (skill: SkillRow) => {
    setConfirm(null);
    try {
      const result = await store.uninstall(skill.id);
      if (result.trashed && result.restoreId) {
        setRestoreId(result.restoreId);
        flash({ tone: "success", text: t("feedback.uninstalled", { name: skill.name }) }, 0);
      } else {
        setRestoreId(null);
        flash({ tone: "success", text: t("feedback.uninstalled", { name: skill.name }) });
      }
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const runRestore = async (restoreId: string | null) => {
    if (!restoreId) return;
    try {
      await store.restore(restoreId);
      setRestoreId(null);
      flash({ tone: "success", text: t("feedback.restored") });
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const runDeleteLocal = async (skill: SkillRow) => {
    setConfirm(null);
    try {
      const result = await store.deleteLocal(skill.directory, skill.targets);
      reportTargetResults(result.targetResults, skill.name);
      if (selectedId === skill.id) setSelectedId(null);
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  /** Sync one engine on/off from the row icon or the detail checkbox: the
   *  message names the engine, because a single-target action must not read
   *  like a bulk result. */
  const onToggleTarget = async (skill: SkillRow, targetId: SkillTargetId, enabled: boolean) => {
    setBusyTarget({ skillId: skill.id, targetId });
    try {
      const next = nextTargets(skill, targetId, enabled);
      const result = skill.managed
        ? await store.setTargets(skill.id, next)
        : await store.importLocal(skill.directory, next);
      const entry = result.targetResults?.find((item) => item.target === targetId);
      if (entry && !entry.ok) {
        flash(
          {
            tone: "error",
            text: t("feedback.syncFailed", {
              engine: targetLabel(targetId),
              error: entry.error ?? "",
            }),
          },
          0,
        );
        return;
      }
      const vars = { name: skill.name, engine: targetLabel(targetId) };
      // The person's own source copy is never deleted: the backend keeps it and
      // marks it kept, so the UI mustn't say "removed" while the icon stays.
      if (!enabled && entry?.kept) {
        flash({ tone: "success", text: t("feedback.keptLocal", vars) });
        return;
      }
      flash({
        tone: "success",
        text: enabled ? t("feedback.syncedOne", vars) : t("feedback.unsyncedOne", vars),
      });
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    } finally {
      // Clear only this toggle's busy state: another engine's may be in flight.
      setBusyTarget((current) =>
        current && current.skillId === skill.id && current.targetId === targetId ? null : current,
      );
    }
  };

  const onImport = async (skill: SkillRow) => {
    try {
      const result = await store.importLocal(skill.directory, skill.targets);
      reportTargetResults(result.targetResults, skill.name);
      setSelectedId(null);
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const onImportFromDialog = async (directory: string, targets: SkillTargetId[]) => {
    try {
      const result = await store.importLocal(directory, targets);
      reportTargetResults(result.targetResults, directory);
      setImportOpen(false);
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const handleConfirm = (pendingConfirm: ConfirmState) => {
    if (pendingConfirm.kind === "uninstall") {
      void runUninstall(pendingConfirm.skill);
      return;
    }
    if (pendingConfirm.kind === "deleteLocal") {
      void runDeleteLocal(pendingConfirm.skill);
      return;
    }
    const skill = pendingConfirm.skill;
    setConfirm(null);
    void runUpdate(skill, true);
  };

  return {
    handleRefresh,
    runUpdate,
    runRestore,
    onToggleTarget,
    onImport,
    onImportFromDialog,
    handleConfirm,
  };
}

export function InstalledPane({ onBrowse }: { onBrowse: () => void }) {
  const store = useInstalledSkills(true);
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState<SkillTargetId | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyTarget, setBusyTarget] = useState<BusyTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [updates, setUpdates] = useState<UpdateMap>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The selected row is derived from the refreshed list, never a stale copy:
  // a toggle in the row (or in the detail panel) must reach the panel that is
  // already open, and a removed skill closes it without a second state source.
  const selected = useMemo(
    () => store.skills.find((skill) => skill.id === selectedId) ?? null,
    [store.skills, selectedId],
  );
  // Usage is only fetched once a detail panel is open (Claude Code transcripts,
  // cached for 10 minutes server-side) — browsing hundreds of skills stays cheap.
  const usageStore = useSkillUsage(selectedId !== null);

  const engineChips = useMemo(
    () => visibleEngines(store.skills, store.targets),
    [store.skills, store.targets],
  );

  const targetLabel = (targetId: string) =>
    store.targets.find((target) => target.id === targetId)?.label ?? targetId;

  const filtered = useMemo(
    () => filterSkills(store.skills, { query, target: engine }),
    [store.skills, query, engine],
  );

  const updateCount = useMemo(() => Object.values(updates).filter(Boolean).length, [updates]);

  const flash = (next: Feedback, ttlMs = 4000) => {
    setFeedback(next);
    if (ttlMs > 0) {
      window.setTimeout(() => {
        setFeedback((current) => (current === next ? null : current));
      }, ttlMs);
    }
  };

  const actions = createInstalledPaneActions({
    store,
    flash,
    targetLabel,
    selectedId,
    setSelectedId,
    setUpdates,
    setConfirm,
    setBusyTarget,
    setRestoreId,
    setImportOpen,
  });

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void actions
      .handleRefresh()
      .catch((error: unknown) => {
        flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
      })
      .finally(() => setRefreshing(false));
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <InstalledToolbar
        query={query}
        onQueryChange={setQuery}
        loading={store.loading}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onOpenImport={() => setImportOpen(true)}
      />

      <EngineFilterChips chips={engineChips} value={engine} onChange={setEngine} />

      <InstalledCountLine
        shown={filtered.length}
        total={store.skills.length}
        updateCount={updateCount}
      />

      <FeedbackLine feedback={feedback} />
      {restoreId ? (
        <Button size="sm" className="self-start" onClick={() => void actions.runRestore(restoreId)}>
          {t("feedback.restoreNow")}
        </Button>
      ) : null}

      <InstalledListArea
        loading={store.loading && store.skills.length === 0}
        error={store.error}
        filtered={filtered}
        totalSkills={store.skills.length}
        updates={updates}
        busySkillId={busyTarget?.skillId ?? null}
        busyTargetId={busyTarget?.targetId ?? null}
        pendingIds={store.pendingIds}
        targets={store.targets}
        onRefresh={() => void store.refresh()}
        onBrowse={onBrowse}
        onOpen={(skill) => setSelectedId(skill.id)}
        onToggleTarget={(skill, targetId, enabled) =>
          void actions.onToggleTarget(skill, targetId, enabled)
        }
        onUpdate={(skill) => void actions.runUpdate(skill, false)}
      />

      {selected ? (
        <SkillDetailDialog
          skill={selected}
          targets={store.targets}
          pending={store.pendingIds.has(selected.id) || store.pendingIds.has(selected.directory)}
          busyTarget={busyTarget?.skillId === selected.id ? busyTarget.targetId : null}
          usage={usageForSkill(usageStore.usage, selected)}
          usageLoading={usageStore.usageLoading}
          usageError={usageStore.usageError}
          hasUpdate={Boolean(updates[selected.id])}
          onClose={() => setSelectedId(null)}
          onToggleTarget={(skill, targetId, enabled) =>
            void actions.onToggleTarget(skill, targetId, enabled)
          }
          onTriggerUpdate={(skill) => void actions.runUpdate(skill, false)}
          onUninstall={(skill) => setConfirm({ kind: "uninstall", skill })}
          onDeleteLocal={(skill) => setConfirm({ kind: "deleteLocal", skill })}
          onImport={(skill) => void actions.onImport(skill)}
        />
      ) : null}

      {importOpen ? (
        <SkillImportDialog
          targets={store.targets}
          busy={store.pendingIds.size > 0}
          onClose={() => setImportOpen(false)}
          onImport={(directory, targets) => void actions.onImportFromDialog(directory, targets)}
        />
      ) : null}

      {confirm ? (
        <SkillConfirmDialog
          confirm={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => actions.handleConfirm(confirm)}
        />
      ) : null}
    </div>
  );
}
