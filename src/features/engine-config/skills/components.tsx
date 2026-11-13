// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Shared bits for the Skills panes: the engine glyph, source and sync badges, the feedback line
 * and the list skeleton. Pure display — no data loading here.
 */
import { Check, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { EngineMark, hasEngineMark } from "../EngineMark";
import {
  Badge,
  IconButton,
  IndicatorDot,
  ListRowSkeleton,
  Spinner,
  Surface,
  Text,
  type SkeletonTrailing,
} from "@/shared/ui";
import { t } from "./strings";
import type { SkillRow, SkillTargetId, SkillTargetInfo } from "./types";
import { copiedTargets, hasOrphanCopy, sourceKindOf } from "./utils";

/** An engine's own mark, or its initial in a quiet tile when Misty has no mark for it. */
export function EngineGlyph({
  engine,
  label,
  size = 16,
}: {
  engine: string;
  label?: string;
  size?: number;
}) {
  if (hasEngineMark(engine)) return <EngineMark engine={engine} size={size} />;
  return (
    <Surface
      as="span"
      aria-hidden
      tone="active"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.6)) }}
      className="inline-grid shrink-0 place-items-center rounded-[4px]"
    >
      {/* The initial is drawn from an attribute, so it stays out of the text around it. */}
      <Text
        bare
        tone="default"
        weight="semibold"
        data-initial={(label ?? engine).slice(0, 1).toUpperCase()}
        className="leading-none before:content-[attr(data-initial)]"
      />
    </Surface>
  );
}

export function SourceBadge({ skill }: { skill: SkillRow }) {
  const kind = sourceKindOf(skill);
  return (
    <Badge variant={kind === "managed" ? "secondary" : "outline"} data-source-kind={kind}>
      {t(`source.${kind}`)}
    </Badge>
  );
}

/** One engine that holds a copy: its mark at full strength means present, a small dot in the
 *  corner means the copy is missing (orphan; pressing it syncs again). Pressing a synced engine
 *  removes that engine's copy. A local skill's own folder is locked: it stays at full strength,
 *  because a faded mark reads as missing, and its title says why it can't be toggled. */
function TargetEngineButton({
  skill,
  target,
  busy,
  disabled,
  onToggleTarget,
}: {
  skill: SkillRow;
  target: SkillTargetInfo;
  busy: boolean;
  disabled: boolean;
  onToggleTarget?: (skill: SkillRow, targetId: SkillTargetId, enabled: boolean) => void;
}) {
  const state = skill.targetStates?.[target.id] ?? "off";
  const label = t(`targetState.${state}`, { engine: target.label });
  // An unmanaged local skill's copy is the person's own folder, which Misty never deletes.
  // Turning it off here would report success and then show the copy again after a refresh.
  const locked = skill.managed !== true && state === "synced";
  return (
    <IconButton
      label={label}
      hint={locked ? `${label} · ${t("row.localCopyLocked")}` : label}
      aria-pressed={state === "synced"}
      data-target={target.id}
      data-target-state={state}
      // aria-disabled rather than disabled while locked: a disabled button gets no hover, so the
      // reason in its hint would never show.
      aria-disabled={locked || undefined}
      disabled={disabled || busy || !onToggleTarget}
      onClick={
        locked
          ? undefined
          : () => onToggleTarget?.(skill, target.id as SkillTargetId, state !== "synced")
      }
      className="relative disabled:cursor-not-allowed disabled:opacity-100 aria-disabled:cursor-not-allowed"
    >
      {busy ? (
        <Spinner size="sm" label={false} />
      ) : (
        <EngineGlyph engine={target.id} label={target.label} />
      )}
      {state === "orphan" && !busy ? <IndicatorDot /> : null}
    </IconButton>
  );
}

export function TargetEngines({
  skill,
  targets,
  busyTarget,
  disabled,
  onToggleTarget,
}: {
  skill: SkillRow;
  targets: SkillTargetInfo[];
  /** Target id whose toggle is in flight for *this* skill. */
  busyTarget?: string | null;
  /** Row-level in-flight state (another action on the same row). */
  disabled?: boolean;
  onToggleTarget?: (skill: SkillRow, targetId: SkillTargetId, enabled: boolean) => void;
}) {
  // Only engines that hold a copy (or lost one) show; adding an engine happens in the detail
  // panel, so a row never fills with faded marks.
  const relevant = copiedTargets(skill, targets);
  if (relevant.length === 0) return null;
  return (
    <span className="flex min-w-0 shrink-0 items-center justify-end gap-1.5">
      {hasOrphanCopy(skill) ? (
        <Text bare tone="muted" className="text-xs">
          {t("orphanHint")}
        </Text>
      ) : null}
      <span
        role="group"
        aria-label={t("row.engines", { name: skill.name })}
        className="flex min-w-0 items-center justify-end gap-0.5"
      >
        {relevant.map((target) => (
          <TargetEngineButton
            key={target.id}
            skill={skill}
            target={target}
            busy={busyTarget === target.id}
            disabled={disabled === true || skill.readonly === true}
            onToggleTarget={onToggleTarget}
          />
        ))}
      </span>
    </span>
  );
}

export type Feedback = { tone: "success" | "error" | "pending"; text: string } | null;

/** An inline status line under a pane's toolbar: spinner, check or alert, then the text. */
export function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <Text
      bare
      as="p"
      role={feedback.tone === "error" ? "alert" : "status"}
      tone={feedback.tone === "error" ? "bright" : "muted"}
      className="flex items-center gap-1.5 text-sm"
    >
      {feedback.tone === "pending" ? (
        <Spinner size="sm" label={false} />
      ) : feedback.tone === "success" ? (
        <Check className="shrink-0" aria-hidden />
      ) : (
        <TriangleAlert className="shrink-0" aria-hidden />
      )}
      {feedback.text}
    </Text>
  );
}

/**
 * First-load placeholder shaped like a list of skill rows: two-line ListRows in the list's own
 * bleed and gap, ending in what the pane's rows end in (engine buttons in My skills, Install in
 * Discover).
 */
export function SkillListSkeleton({
  label,
  rows = 4,
  trailing,
}: {
  label: string;
  rows?: number;
  trailing: SkeletonTrailing;
}) {
  return (
    <ListRowSkeleton
      label={label}
      rows={rows}
      lines={2}
      trailing={trailing}
      className="-mx-2 gap-0.5"
    />
  );
}

/** A failure inside a pane: the message and a way to try again. */
export function InlineError({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <Text bare as="p" role="alert" tone="bright" className="flex items-center gap-1.5 text-sm">
        <TriangleAlert className="shrink-0" aria-hidden />
        {message}
      </Text>
      {action}
    </div>
  );
}

/** A quiet empty line inside a pane, with an optional action under it. */
export function EmptyLine({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Text bare as="p" tone="muted" className="text-sm">
        {text}
      </Text>
      {action}
    </div>
  );
}
