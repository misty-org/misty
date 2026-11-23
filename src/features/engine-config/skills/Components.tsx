// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, hasMark, Mark, Surface, Text } from "@misty/ui";
import { t } from "./strings";
import type { SkillRow } from "./types";
import { sourceKindOf } from "./utils";

export function EngineGlyph({
  engine,
  label,
  size = 16,
}: {
  engine: string;
  label?: string;
  size?: number;
}) {
  if (hasMark(`engine:${engine}`)) return <Mark of={`engine:${engine}`} size={size} />;
  return (
    <Surface
      as="span"
      aria-hidden
      tone="active"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.6)) }}
      className="inline-grid shrink-0 place-items-center rounded-sm"
    >
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

export function InlineError({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <Text
        size="control"
        bare
        as="p"
        role="alert"
        tone="bright"
        className="flex items-center gap-1.5"
      >
        <TriangleAlert className="shrink-0" aria-hidden />
        {message}
      </Text>
      {action}
    </div>
  );
}

export function EmptyLine({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Text size="meta" bare as="p" tone="muted">
        {text}
      </Text>
      {action}
    </div>
  );
}
