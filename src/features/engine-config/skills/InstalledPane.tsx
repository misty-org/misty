// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import type { Dispatch, SetStateAction } from "react";
import { skillsHubApi } from "./api";
import { t } from "./strings";
import type { Feedback } from "./Components";
import type { BusyTarget, ConfirmState, UpdateMap } from "./InstalledPane.parts";
import type { InstalledSkillsStore } from "./use_installed_skills";
import type { SkillRow, SkillTargetId } from "./types";
import { nextTargets, summarizeTargetResults } from "./utils";

export interface PaneActionDeps {
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

export function createInstalledPaneActions(deps: PaneActionDeps) {
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
