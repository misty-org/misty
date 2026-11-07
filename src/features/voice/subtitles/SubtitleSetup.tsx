import { useEffect, useState } from "react";
import { Button } from "@/shared/ui";
import { categoryLabel } from "./subtitleContext";
import { languageName } from "./subtitleLanguages";
import type { ControlGroup } from "./SubtitleToolbar";
import type { SubtitlesView } from "./subtitlesView";

type Field = { group: ControlGroup; label: string; value: string };

const ROTATE_MS = 6000;
const percent = (value: number, muted: boolean) =>
  `${Math.round(value * 100)}%${muted ? " (muted)" : ""}`;

function fields({ prefs, pageTopic }: SubtitlesView): Field[] {
  const { context } = prefs;
  return [
    prefs.mode === "translate"
      ? {
          group: "languages",
          label: "Translate",
          value: `${languageName(prefs.source)} → ${languageName(prefs.target)}`,
        }
      : { group: "languages", label: "Subtitles", value: languageName(prefs.source) },
    { group: "context", label: "Context", value: categoryLabel(context) },
    ...(pageTopic ? [{ group: "context" as const, label: "Page", value: pageTopic }] : []),
    ...(context.text.trim()
      ? [{ group: "context" as const, label: "Notes", value: context.text.trim() }]
      : []),
    ...(context.terms.length
      ? [{ group: "context" as const, label: "Terms", value: context.terms.join(", ") }]
      : []),
    { group: "audio", label: "Volume", value: percent(prefs.gain, prefs.muted) },
    { group: "silence", label: "Auto-stop", value: `${prefs.silenceSeconds}s of silence` },
  ];
}

/** Audeeo's rolling line: one thing about this session at a time, and a click opens its control. */
export function SubtitleSetup(props: {
  view: SubtitlesView;
  paused: boolean;
  onOpen: (group: ControlGroup) => void;
}) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const all = fields(props.view);
  const field = all[index % all.length];
  const stopped = props.paused || hovered;
  useEffect(() => {
    if (stopped) return;
    const timer = setTimeout(() => setIndex((current) => current + 1), ROTATE_MS);
    return () => clearTimeout(timer);
  }, [stopped, index]);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="subtitle-setup"
      title={`${field.label}: ${field.value}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => props.onOpen(field.group)}
    >
      <span key={field.label} className="subtitle-setup-row">
        <span>{field.label}:</span> <strong>{field.value}</strong>
      </span>
    </Button>
  );
}
