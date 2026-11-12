// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Presentation pieces for My skills (InstalledPane): toolbar, engine filter chips, count line,
 * skill row, list area and the destructive-confirm dialog. Kept apart so both this and the pane
 * stay readable.
 */
import { Plus, RefreshCw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  FilterChip,
  ListRow,
  SearchField,
  Tooltip,
} from "@/shared/ui";
import {
  EmptyLine,
  EngineGlyph,
  InlineError,
  SkillListSkeleton,
  SourceBadge,
  TargetEngines,
} from "./components";
import { t } from "./strings";
import type { SkillRow, SkillTargetId, SkillTargetInfo } from "./types";

/** The update map is keyed by skill id; local (unmanaged) entries never have upstream updates. */
export type UpdateMap = Record<string, boolean>;

/** Engine toggle currently in flight: only that row's icon is disabled. */
export type BusyTarget = { skillId: string; targetId: string };

export type ConfirmState =
  | { kind: "uninstall"; skill: SkillRow }
  | { kind: "deleteLocal"; skill: SkillRow }
  | { kind: "overwrite"; skill: SkillRow };

/** Search, check for updates and import. */
export function InstalledToolbar({
  query,
  onQueryChange,
  loading,
  refreshing,
  onRefresh,
  onOpenImport,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenImport: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <SearchField
        containerClassName="flex-1"
        aria-label={t("searchPlaceholder")}
        placeholder={t("searchPlaceholder")}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <Button icon={RefreshCw} loading={refreshing} disabled={loading} onClick={onRefresh}>
        {t("refresh")}
      </Button>
      <Button icon={Plus} disabled={loading} onClick={onOpenImport}>
        {t("actions.importLocal")}
      </Button>
    </div>
  );
}

/** Engine filter chips (installed engines plus engines holding copies). */
export function EngineFilterChips({
  chips,
  value,
  onChange,
}: {
  chips: SkillTargetInfo[];
  value: SkillTargetId | "";
  onChange: (value: SkillTargetId | "") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterChip
        label={t("filter.allEngines")}
        pressed={value === ""}
        onPressedChange={() => onChange("")}
      />
      {chips.map((target) => (
        <Tooltip key={target.id} content={target.path}>
          <FilterChip
            label={target.label}
            icon={<EngineGlyph engine={target.id} label={target.label} size={12} />}
            pressed={value === target.id}
            onPressedChange={() => onChange(target.id as SkillTargetId)}
          />
        </Tooltip>
      ))}
    </div>
  );
}

/** Result count with the pending-updates note. */
export function InstalledCountLine({
  shown,
  total,
  updateCount,
}: {
  shown: number;
  total: number;
  updateCount: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-cream-muted">
      <p>{t("count", { count: shown, total })}</p>
      {updateCount > 0 ? (
        <p className="text-cream">{t("updatesAvailable", { count: updateCount })}</p>
      ) : null}
    </div>
  );
}

/** One installed skill: a button that opens its details, its engines, and Update. */
function SkillRowItem({
  skill,
  targets,
  pending,
  busyTarget,
  hasUpdate,
  onOpen,
  onToggleTarget,
  onUpdate,
}: {
  skill: SkillRow;
  targets: SkillTargetInfo[];
  pending: boolean;
  busyTarget: string | null;
  hasUpdate: boolean;
  onOpen: () => void;
  onToggleTarget: (skill: SkillRow, targetId: SkillTargetId, enabled: boolean) => void;
  onUpdate: () => void;
}) {
  return (
    // ListRow is a div; the list item around it keeps the list a list.
    <li className="list-none">
      <ListRow
        label={skill.name}
        description={skill.description || skill.directory}
        badge={<SourceBadge skill={skill} />}
        aria-label={t("row.open", { name: skill.name })}
        className={cn("gap-2", pending && "opacity-60")}
        onOpen={onOpen}
        trailing={
          <>
            <TargetEngines
              skill={skill}
              targets={targets}
              busyTarget={busyTarget}
              disabled={pending}
              onToggleTarget={onToggleTarget}
            />
            {hasUpdate ? (
              <Button variant="primary" size="sm" disabled={pending} onClick={onUpdate}>
                {t("actions.update")}
              </Button>
            ) : null}
          </>
        }
      />
    </li>
  );
}

/** The list area: a first-load skeleton, an error, an empty state, or the rows. Errors and
 *  loading win over the empty state, so a failed refresh is never silent. */
export function InstalledListArea({
  loading,
  error,
  filtered,
  totalSkills,
  updates,
  busySkillId,
  busyTargetId,
  pendingIds,
  targets,
  onRefresh,
  onBrowse,
  onOpen,
  onToggleTarget,
  onUpdate,
}: {
  loading: boolean;
  error: string | null;
  filtered: SkillRow[];
  totalSkills: number;
  updates: UpdateMap;
  busySkillId: string | null;
  busyTargetId: string | null;
  pendingIds: ReadonlySet<string>;
  targets: SkillTargetInfo[];
  onRefresh: () => void;
  onBrowse: () => void;
  onOpen: (skill: SkillRow) => void;
  onToggleTarget: (skill: SkillRow, targetId: SkillTargetId, enabled: boolean) => void;
  onUpdate: (skill: SkillRow) => void;
}) {
  if (loading) return <SkillListSkeleton label="Installed skills" />;
  if (error) {
    return (
      <InlineError
        message={error}
        action={<Button onClick={onRefresh}>{t("common.refresh")}</Button>}
      />
    );
  }
  if (filtered.length === 0) {
    return (
      <EmptyLine
        text={totalSkills === 0 ? t("empty.none") : t("empty.filtered")}
        action={
          totalSkills === 0 ? <Button onClick={onBrowse}>{t("empty.browse")}</Button> : undefined
        }
      />
    );
  }
  return (
    <ul className="-mx-2 flex flex-col gap-0.5">
      {filtered.map((skill) => (
        <SkillRowItem
          key={skill.id}
          skill={skill}
          targets={targets}
          pending={pendingIds.has(skill.id) || pendingIds.has(skill.directory)}
          busyTarget={busySkillId === skill.id ? busyTargetId : null}
          hasUpdate={Boolean(updates[skill.id])}
          onOpen={() => onOpen(skill)}
          onToggleTarget={onToggleTarget}
          onUpdate={() => onUpdate(skill)}
        />
      ))}
    </ul>
  );
}

/** Uninstall, local delete and overwrite confirmation. */
export function SkillConfirmDialog({
  confirm,
  onCancel,
  onConfirm,
}: {
  confirm: ConfirmState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const name = confirm.skill.name;
  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirm.kind === "uninstall"
              ? t("confirm.uninstallTitle", { name })
              : confirm.kind === "deleteLocal"
                ? t("confirm.deleteTitle", { name })
                : t("confirm.overwriteTitle", { name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirm.kind === "uninstall"
              ? t("confirm.uninstallBody")
              : confirm.kind === "deleteLocal"
                ? t("confirm.deleteBody")
                : t("confirm.overwriteBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirm.kind === "deleteLocal" && confirm.skill.targetPaths ? (
          <ul className="flex flex-col gap-1 rounded-md bg-charcoal-bg/60 p-2">
            {Object.values(confirm.skill.targetPaths).map((path) => (
              <li key={path} className="break-all font-mono text-xs text-cream-muted">
                {path}
              </li>
            ))}
          </ul>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirm.kind === "overwrite"
              ? t("confirm.overwriteConfirm")
              : confirm.kind === "uninstall"
                ? t("actions.uninstall")
                : t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
