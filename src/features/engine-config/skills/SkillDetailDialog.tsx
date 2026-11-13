// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Skill details: metadata, per-engine sync ("Sync to"), invocation activity and the destructive
 * actions. SKILL.md is read when the dialog opens (never with the list), so browsing hundreds of
 * skills stays cheap; usage comes from the pane, which loads it once per open dialog.
 */
import { ExternalLink, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { HostMarkdown } from "../host";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Pressable,
  Skeleton,
  SkeletonDocument,
  Spinner,
  Surface,
  Text,
  cn,
  OverflowFadeText,
  Tooltip,
} from "@/shared/ui";
import { skillsHubApi } from "./api";
import { EngineGlyph, InlineError, SourceBadge } from "./components";
import { t } from "./strings";
import type {
  SkillRow,
  SkillSourceKind,
  SkillTargetId,
  SkillTargetInfo,
  SkillUsageEntry,
} from "./types";
import { daysSince, relevantTargets, sourceKindOf } from "./utils";

interface SkillContentState {
  path: string;
  markdown: string;
  truncated: boolean;
}

function PropertyRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <Text bare tone="muted" className="shrink-0 text-sm">
        {label}
      </Text>
      <Text bare tone="default" className="min-w-0 text-right text-sm">
        {children}
      </Text>
    </div>
  );
}

/** "Last used": never, today, N days ago or N months ago. */
function lastUsedLabel(usage?: SkillUsageEntry | null): string {
  if (usage?.lastUsedAt == null) return t("detail.neverUsed");
  const days = daysSince(usage.lastUsedAt);
  if (days == null) return t("detail.neverUsed");
  if (days <= 0) return t("usage.today");
  if (days < 30) return t("usage.daysAgo", { days });
  return t("usage.monthsAgo", { months: Math.max(1, Math.floor(days / 30)) });
}

/** Repository link, folder and each engine's copy. */
function DetailProperties({ skill }: { skill: SkillRow }) {
  return (
    <Surface tone="none" edge="hairline" radius="lg" className="shrink-0 px-3 py-1">
      {skill.repoOwner && skill.repoName ? (
        <PropertyRow label={t("detail.repository")}>
          <Pressable
            className="inline-flex text-sm hover:underline"
            onClick={() => (skill.readmeUrl ? void openExternalLink(skill.readmeUrl) : undefined)}
          >
            <Text bare tone="bright" className="inline-flex items-center gap-1">
              {skill.repoOwner}/{skill.repoName}
              <ExternalLink aria-hidden />
            </Text>
          </Pressable>
        </PropertyRow>
      ) : null}
      <PropertyRow label={t("detail.directory")}>
        <span className="break-all text-xs">{skill.directory}</span>
      </PropertyRow>
      {skill.targetPaths && Object.keys(skill.targetPaths).length > 0 ? (
        <PropertyRow label={t("detail.paths")}>
          <span className="flex flex-col gap-0.5">
            {Object.entries(skill.targetPaths).map(([key, value]) => (
              <span key={`${key}:${value}`} className="break-all text-xs">
                {value}
              </span>
            ))}
          </span>
        </PropertyRow>
      ) : null}
    </Surface>
  );
}

/** Invocation count and last use; a failed load shows "—" with a note, never a made-up "never
 *  used". */
function SkillActivitySection({
  usage,
  usageLoading,
  usageError,
}: {
  usage?: SkillUsageEntry | null;
  usageLoading?: boolean;
  usageError?: string | null;
}) {
  const unavailable = Boolean(usageError);
  const invocations = usage?.invocations ?? 0;
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <Text bare as="p" tone="bright" weight="medium" className="text-sm">
        {t("detail.activity")}
      </Text>
      <Surface tone="none" edge="hairline" radius="lg" className="px-3 py-1">
        <PropertyRow label={t("detail.invocations")}>
          {usageLoading ? (
            <Skeleton className="h-3 w-8" />
          ) : (
            <span className="tabular-nums">{unavailable ? "—" : invocations}</span>
          )}
        </PropertyRow>
        <PropertyRow label={t("detail.lastUsed")}>
          {usageLoading ? (
            <Skeleton className="h-3 w-16" />
          ) : unavailable ? (
            "—"
          ) : (
            lastUsedLabel(usage)
          )}
        </PropertyRow>
      </Surface>
      {unavailable ? (
        <Text bare as="p" tone="muted" className="text-xs">
          {t("detail.usageUnavailable")}
        </Text>
      ) : !usageLoading && invocations === 0 ? (
        <Text bare as="p" tone="muted" className="text-xs">
          {t("detail.unusedHint")}
        </Text>
      ) : null}
    </div>
  );
}

/** One checkbox per engine ("Sync to"). */
function SkillTargetsSection({
  skill,
  engineTargets,
  hiddenEngineCount,
  readonly,
  kind,
  pending,
  busyTarget,
  onToggleTarget,
}: {
  skill: SkillRow;
  engineTargets: SkillTargetInfo[];
  hiddenEngineCount: number;
  readonly: boolean;
  kind: SkillSourceKind;
  pending: boolean;
  busyTarget?: string | null;
  onToggleTarget: (targetId: SkillTargetId, enabled: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <Text bare as="p" tone="bright" weight="medium" className="text-sm">
        {t("detail.syncTo")}
      </Text>
      <div className="flex max-h-[13rem] flex-col gap-0.5 overflow-y-auto pr-1">
        {engineTargets.map((target) => {
          const state = skill.targetStates?.[target.id] ?? "off";
          const busy = busyTarget === target.id;
          // An unmanaged local skill's copy is the person's own folder and can't be turned off here.
          const locked = !skill.managed && state === "synced";
          const disabled = readonly || pending || busy || locked;
          return (
            <Tooltip key={target.id} content={locked ? t("row.localCopyLocked") : ""}>
              <label
                className={cn(
                  "flex items-center gap-2 rounded-md px-1.5 py-1 text-sm",
                  !disabled && "cursor-pointer hover:bg-control-hover",
                )}
              >
                <Checkbox
                  checked={state === "synced"}
                  disabled={disabled}
                  onCheckedChange={(next) =>
                    onToggleTarget(target.id as SkillTargetId, next === true)
                  }
                />
                <EngineGlyph engine={target.id} label={target.label} />
                <Text bare tone="default">
                  {target.label}
                </Text>
                <Text bare tone="muted" className="ml-auto flex items-center gap-1.5 text-xs">
                  {busy ? <Spinner size="sm" label={false} /> : null}
                  {t(`targetStateShort.${state}`)}
                </Text>
              </label>
            </Tooltip>
          );
        })}
      </div>
      {hiddenEngineCount > 0 ? (
        <Text bare as="p" tone="muted" className="text-xs">
          {t("detail.hiddenEngines", { count: hiddenEngineCount })}
        </Text>
      ) : null}
      {readonly ? (
        <Text bare as="p" tone="muted" className="text-xs">
          {t(`readonly.${kind}`)}
        </Text>
      ) : null}
      {!skill.managed && !readonly ? (
        <Text bare as="p" tone="muted" className="text-xs">
          {t("detail.promoteHint")}
        </Text>
      ) : null}
    </div>
  );
}

/** SKILL.md in its own bounded scroll, so one long file can't push the switches out of sight. */
export function SkillMarkdown({
  loading,
  error,
  content,
  loadingLabel,
  failed,
}: {
  loading: boolean;
  error: string | null;
  content: SkillContentState | null;
  loadingLabel: string;
  failed?: ReactNode;
}) {
  return (
    <Surface
      tone="none"
      edge="hairline"
      radius="lg"
      className="min-h-[6rem] max-h-[20rem] shrink-0 overflow-y-auto p-3 text-sm"
    >
      {loading ? (
        // Two paragraphs fit the panel's 20rem without a scrollbar of their own.
        <SkeletonDocument label={loadingLabel} paragraphs={2} className="max-w-none gap-4 p-0" />
      ) : error ? (
        failed
      ) : content ? (
        <>
          <HostMarkdown>{content.markdown}</HostMarkdown>
          {content.truncated ? (
            <Text bare as="p" tone="muted" className="mt-2 text-xs">
              {t("detail.contentTruncated")}
            </Text>
          ) : null}
        </>
      ) : null}
    </Surface>
  );
}

export function SkillDetailDialog({
  skill,
  targets,
  pending,
  busyTarget,
  usage,
  usageLoading,
  usageError,
  hasUpdate,
  onClose,
  onToggleTarget,
  onTriggerUpdate,
  onUninstall,
  onDeleteLocal,
  onImport,
}: {
  skill: SkillRow;
  targets: SkillTargetInfo[];
  pending: boolean;
  busyTarget?: string | null;
  usage?: SkillUsageEntry | null;
  usageLoading?: boolean;
  usageError?: string | null;
  hasUpdate: boolean;
  onClose: () => void;
  onToggleTarget: (skill: SkillRow, targetId: SkillTargetId, enabled: boolean) => void;
  onTriggerUpdate: (skill: SkillRow) => void;
  onUninstall: (skill: SkillRow) => void;
  onDeleteLocal: (skill: SkillRow) => void;
  onImport: (skill: SkillRow) => void;
}) {
  const [content, setContent] = useState<SkillContentState | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadContent = useCallback(async () => {
    const current = sequence.current + 1;
    sequence.current = current;
    const canCommit = () => mounted.current && sequence.current === current;
    setLoading(true);
    setContentError(null);
    try {
      const payload = await skillsHubApi.content(skill.directory);
      if (!canCommit()) return;
      setContent({ path: payload.path, markdown: payload.markdown, truncated: payload.truncated });
    } catch (error) {
      if (!canCommit()) return;
      setContent(null);
      setContentError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading((value) => (canCommit() ? false : value));
    }
  }, [skill.directory]);

  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  const readonly = skill.readonly === true;
  const kind = sourceKindOf(skill);
  // Only engines that are installed, or already hold a copy, are offered.
  const engineTargets = relevantTargets(skill, targets);
  const hiddenEngineCount = targets.length - engineTargets.length;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[80vh] max-w-140 flex-col gap-3">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle>
            <OverflowFadeText full>{skill.name}</OverflowFadeText>
          </DialogTitle>
          <div className="flex min-w-0 items-center gap-2">
            <SourceBadge skill={skill} />
            <Text full tone="muted" className="text-xs">
              {skill.directory}
            </Text>
          </div>
        </DialogHeader>

        {/* One scroll for description, properties, activity and the sync list, so the footer
            stays inside the dialog however many engines there are. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {skill.description ? (
            <Text bare as="p" tone="muted" className="shrink-0 text-sm">
              {skill.description}
            </Text>
          ) : null}
          <DetailProperties skill={skill} />
          <SkillActivitySection usage={usage} usageLoading={usageLoading} usageError={usageError} />
          <SkillTargetsSection
            skill={skill}
            engineTargets={engineTargets}
            hiddenEngineCount={hiddenEngineCount}
            readonly={readonly}
            kind={kind}
            pending={pending}
            busyTarget={busyTarget}
            onToggleTarget={(targetId, enabled) => onToggleTarget(skill, targetId, enabled)}
          />
          <SkillMarkdown
            loading={loading}
            error={contentError}
            content={content}
            loadingLabel={t("detail.contentLoading")}
            failed={
              <InlineError
                message={contentError ?? ""}
                action={
                  <Button size="sm" onClick={() => void loadContent()}>
                    {t("common.refresh")}
                  </Button>
                }
              />
            }
          />
        </div>

        <div className="flex shrink-0 flex-col gap-3">
          {!readonly ? (
            <Tooltip content={t("detail.removeAllHint")}>
              <Button
                className="w-full"
                disabled={pending}
                onClick={() => (skill.managed ? onUninstall(skill) : onDeleteLocal(skill))}
              >
                <Trash2 aria-hidden />
                {t("detail.removeAll")}
              </Button>
            </Tooltip>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              {!skill.managed && !readonly ? (
                <Button disabled={pending} onClick={() => onImport(skill)}>
                  {t("actions.import")}
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              {hasUpdate ? (
                <Button variant="primary" disabled={pending} onClick={() => onTriggerUpdate(skill)}>
                  {t("actions.update")}
                </Button>
              ) : null}
              <Button onClick={onClose}>{t("common.close")}</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
