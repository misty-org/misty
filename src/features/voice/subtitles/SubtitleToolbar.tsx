import {
  BookOpenText,
  ChevronDown,
  Languages,
  Mic,
  Monitor,
  Timer,
  Volume2,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/shared/ui";
import { SubtitleControls } from "./SubtitleControls";
import type { SubtitlesAction, SubtitlesView } from "./subtitlesView";

export type ControlGroup = "input" | "languages" | "context" | "audio" | "silence";

const labels: Record<ControlGroup, string> = {
  input: "Source",
  languages: "Languages",
  context: "Context",
  audio: "Volume",
  silence: "Auto-stop",
};

/** Audeeo's toolbar: each control opens its card above the bar, inside the panel. */
export function SubtitleToolbar(props: {
  view: SubtitlesView;
  act: (action: SubtitlesAction) => void;
  open: ControlGroup | null;
  setOpen: (group: ControlGroup | null) => void;
}) {
  const { view, act, open, setOpen } = props;
  const root = useRef<HTMLElement>(null);
  const icons = {
    input: view.prefs.input === "system" ? Monitor : Mic,
    languages: Languages,
    context: BookOpenText,
    audio: Volume2,
    silence: Timer,
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      // A select's menu is portaled outside the toolbar and closes itself first.
      if (document.querySelector("[data-slot='select-content'], [role='listbox']")) return;
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role='listbox']")) setOpen(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, setOpen]);
  return (
    <footer ref={root} className="subtitle-footer">
      {open && (
        <div role="dialog" aria-label={labels[open]} className={`subtitle-card subtitle-card-${open}`}>
          <SubtitleControls group={open} view={view} act={act} />
        </div>
      )}
      <div className="subtitle-toolbar" role="toolbar" aria-label="Subtitle controls">
        {(Object.keys(labels) as ControlGroup[]).map((group) => {
          const Icon = icons[group];
          return (
            <Button
              key={group}
              variant="ghost"
              size="sm"
              className="subtitle-tool"
              aria-haspopup="dialog"
              aria-expanded={open === group}
              onClick={() => setOpen(open === group ? null : group)}
            >
              <Icon aria-hidden />
              <span>{labels[group]}</span>
              <ChevronDown className="subtitle-tool-chevron" aria-hidden />
            </Button>
          );
        })}
      </div>
    </footer>
  );
}
