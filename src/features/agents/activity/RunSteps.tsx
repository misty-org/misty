import {
  Bot,
  Compass,
  Eye,
  Hand,
  ListChecks,
  MousePointerClick,
  Pause,
  PencilLine,
  Play,
  Plug,
  Search,
  SquareTerminal,
  TriangleAlert,
  Type,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton, Pressable } from "@/shared/ui";
import type { RunStep } from "./activityApi";
import { describeSteps, offsetLabel, type DescribedStep, type StepVerb } from "./stepSentences";
import { useStepPicture } from "./useRunSteps";
import "./activity.css";

const verbIcon: Record<StepVerb, LucideIcon> = {
  open: Compass,
  read: Eye,
  click: MousePointerClick,
  type: Type,
  run: SquareTerminal,
  write: PencilLine,
  search: Search,
  ask: Hand,
  plan: ListChecks,
  delegate: Bot,
  app: Plug,
  other: Wrench,
};

/** How long each picture shows while a run plays back. */
const PLAY_EVERY_MS = 1200;

/** The picture of the page after a step, or nothing when the step has none. */
export function StepPicture(props: {
  runId: string;
  picture: string;
  className?: string;
  alt?: string;
}) {
  const address = useStepPicture(props.runId, props.picture);
  if (!props.picture) return null;
  return (
    <span className={`activity-picture ${props.className ?? ""}`}>
      {address ? <img src={address} alt={props.alt ?? ""} decoding="async" /> : null}
    </span>
  );
}

/**
 * "What happened" in one run: every step as a sentence, oldest first, with its time into the run.
 * Steps that pictured a page show it above the list, and the run plays back picture by picture.
 * Housekeeping is hidden behind a count unless the person asks for it.
 */
export function RunSteps(props: {
  runId: string;
  steps: RunStep[];
  startedAt: number;
  folder?: string;
  /** Show the pictures and playback; a compact list leaves them out. */
  pictures?: boolean;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const described = useMemo(
    () => describeSteps(props.steps, { folder: props.folder, includeHidden: showHidden }),
    [props.steps, props.folder, showHidden],
  );
  const steps = described.steps;
  const pictured = useMemo(() => steps.filter((step) => step.picture), [steps]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  // Playback walks the pictured steps, then stops on the last.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setChosen((current) => {
        const index = pictured.findIndex((step) => step.seqs[0] === current);
        const next = pictured[index + 1];
        if (!next) {
          setPlaying(false);
          return current;
        }
        return next.seqs[0]!;
      });
    }, PLAY_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [playing, pictured]);

  // The chosen step stays in view in the list's own scroll area.
  useEffect(() => {
    if (chosen === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-step="${chosen}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [chosen]);

  const shownStep: DescribedStep | undefined =
    steps.find((step) => step.seqs[0] === chosen) ?? pictured[pictured.length - 1];
  const shownPicture = shownStep?.picture || pictured[pictured.length - 1]?.picture || "";

  const play = () => {
    if (playing) return setPlaying(false);
    // From the start, unless the person picked a step part way through.
    const at = pictured.findIndex((step) => step.seqs[0] === chosen);
    if (at < 0 || at === pictured.length - 1) setChosen(pictured[0]?.seqs[0] ?? null);
    setPlaying(true);
  };

  return (
    <div className="activity-run">
      {props.pictures && pictured.length ? (
        <div className="activity-player">
          <StepPicture
            runId={props.runId}
            picture={shownPicture}
            className="activity-player-picture"
          />
          <div className="activity-player-bar">
            <IconButton label={playing ? "Pause" : "Play back"} onClick={play}>
              {playing ? (
                <Pause size={15} aria-hidden="true" />
              ) : (
                <Play size={15} aria-hidden="true" />
              )}
            </IconButton>
            <span className="activity-player-caption">{shownStep?.sentence}</span>
            <span className="activity-muted tabular-nums">
              {Math.max(1, pictured.indexOf(shownStep!) + 1 || pictured.length)} of{" "}
              {pictured.length}
            </span>
          </div>
        </div>
      ) : null}
      {steps.length === 0 ? (
        <p className="activity-empty">No steps yet.</p>
      ) : (
        <ol ref={listRef} className="activity-steps">
          {steps.map((step) => {
            const Icon = step.failed ? TriangleAlert : verbIcon[step.verb];
            const selected = shownStep === step && props.pictures && pictured.length > 0;
            return (
              <li
                key={step.seqs[0]}
                data-step={step.seqs[0]}
                data-hidden={step.hidden || undefined}
                data-nested={step.nested || undefined}
              >
                <Pressable
                  type="button"
                  className="activity-step"
                  aria-current={selected ? "step" : undefined}
                  data-failed={step.failed || undefined}
                  data-running={step.running || undefined}
                  onClick={() => {
                    setPlaying(false);
                    setChosen(step.seqs[0]!);
                  }}
                >
                  <Icon
                    size={14}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className="activity-step-icon"
                  />
                  <span className="activity-step-sentence">
                    {step.sentence}
                    {step.failed ? <span className="sr-only">, which didn't work</span> : null}
                  </span>
                  {step.seqs.length > 1 ? (
                    <span className="activity-muted tabular-nums">×{step.seqs.length}</span>
                  ) : null}
                  <span className="activity-muted tabular-nums">
                    {offsetLabel(step.at, props.startedAt)}
                  </span>
                </Pressable>
              </li>
            );
          })}
        </ol>
      )}
      {described.hiddenCount > 0 ? (
        <div className="activity-hidden-note">
          <span>
            {described.hiddenCount} behind-the-scenes{" "}
            {described.hiddenCount === 1 ? "step" : "steps"}
          </span>
          <Button variant="quiet" onClick={() => setShowHidden((value) => !value)}>
            {showHidden ? "Hide them" : "Show them"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
