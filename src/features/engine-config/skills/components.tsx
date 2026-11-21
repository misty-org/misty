// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Shared bits for the Skills panes: the engine glyph, source and sync badges, the feedback line
 * and the list skeleton. Pure display — no data loading here.
 */
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { EngineMark, hasEngineMark } from "../EngineMark";
import { Badge, Surface, Text } from "@misty/ui";
import { t } from "./strings";
import type { SkillRow } from "./types";
import { sourceKindOf } from "./utils";

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
      className="inline-grid shrink-0 place-items-center rounded-sm"
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

export type Feedback = { tone: "success" | "error" | "pending"; text: string } | null;

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
