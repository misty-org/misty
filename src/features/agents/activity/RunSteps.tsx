import {
  Network,
  Compass,
  Eye,
  Hand,
  ListChecks,
  MousePointerClick,
  Pause,
  PencilLine,
  Play,
  Plug,
  ScrollText,
  Search,
  SquareTerminal,
  TriangleAlert,
  Type,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import {
  Button,
  cn,
  IconButton,
  OverflowFadeText,
  Pressable,
  Surface,
  Text,
  rowShapeWrap,
} from "@misty/ui";
import type { RunStep } from "./activity_api";
import { describeSteps, offsetLabel, type DescribedStep, type StepVerb } from "./step_sentences";
import { useStepPicture } from "./use_run_steps";

export const useShowHiddenSteps = createDeviceSetting<boolean>({
  scope: "run-steps-show-hidden",
  defaults: false,
  normalize: (stored) => stored === true,
});

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
  delegate: Network,
  app: Plug,
  other: Wrench,
};

const PLAY_EVERY_MS = 1200;

export function StepPicture(props: {
  runId: string;
  picture: string;
  fill?: boolean;
  alt?: string;
}) {
  const address = useStepPicture(props.runId, props.picture);
  if (!props.picture) return null;
  return (
    <Surface
      as="span"
      tone={props.fill ? "none" : "well"}
      radius={props.fill ? "none" : "lg"}
      className={cn("block overflow-hidden", props.fill ? "h-full" : "aspect-[16/10]")}
    >
      {address ? (
        <img
          src={address}
          alt={props.alt ?? ""}
          decoding="async"
          className="block size-full object-cover object-[top_left]"
        />
      ) : null}
    </Surface>
  );
}

function Figure({ children }: { children: ReactNode }) {
  return (
    <Text bare size="caption" tone="muted" className="shrink-0 tabular-nums">
      {children}
    </Text>
  );
}

export function RunSteps(props: {
  runId: string;
  steps: RunStep[];
  startedAt: number;
  folder?: string;
  pictures?: boolean;
  onOpenBrowserLog?: (callId: string) => void;
}) {
  const showHidden = useShowHiddenSteps((state) => state.value);
  const described = useMemo(
    () => describeSteps(props.steps, { folder: props.folder, includeHidden: showHidden }),
    [props.steps, props.folder, showHidden],
  );
  const steps = described.steps;
  const pictured = useMemo(() => steps.filter((step) => step.picture), [steps]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

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
    const at = pictured.findIndex((step) => step.seqs[0] === chosen);
    if (at < 0 || at === pictured.length - 1) setChosen(pictured[0]?.seqs[0] ?? null);
    setPlaying(true);
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {props.pictures && pictured.length ? (
        <div className="grid gap-1.5">
          <StepPicture runId={props.runId} picture={shownPicture} />
          <div className="flex min-w-0 items-center gap-1.5 pr-1">
            <IconButton label={playing ? "Pause" : "Play back"} onClick={play}>
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </IconButton>
            <Text size="meta" tone="default" className="flex-1">
              {shownStep?.sentence}
            </Text>
            <Figure>
              {Math.max(1, pictured.indexOf(shownStep!) + 1 || pictured.length)} of{" "}
              {pictured.length}
            </Figure>
          </div>
        </div>
      ) : null}
      {steps.length === 0 ? (
        <RunStepsEmpty>No steps yet.</RunStepsEmpty>
      ) : (
        <ol ref={listRef} className="m-0 grid list-none p-0">
          {steps.map((step) => {
            const Icon = step.failed ? TriangleAlert : verbIcon[step.verb];
            const selected = shownStep === step && props.pictures && pictured.length > 0;
            return (
              <Text
                as="li"
                bare
                size="meta"
                tone={step.hidden ? "muted" : "default"}
                key={step.seqs[0]}
                data-step={step.seqs[0]}
                data-hidden={step.hidden || undefined}
                data-nested={step.nested || undefined}
                className="group/step flex min-w-0 items-center gap-0.5 data-[nested]:pl-3.5"
              >
                <Pressable
                  type="button"
                  wash="control"
                  selected={selected}
                  className={cn(rowShapeWrap, "min-w-0 flex-1")}
                  aria-current={selected ? "step" : undefined}
                  data-failed={step.failed || undefined}
                  data-running={step.running || undefined}
                  onClick={() => {
                    setPlaying(false);
                    setChosen(step.seqs[0]!);
                  }}
                >
                  <Text
                    bare
                    tone={step.failed ? "failed" : step.running ? "working" : "muted"}
                    className="flex shrink-0"
                  >
                    <Icon aria-hidden="true" />
                  </Text>
                  <OverflowFadeText className="flex-1">
                    {step.sentence}
                    {step.failed ? <span className="sr-only">, which didn't work</span> : null}
                  </OverflowFadeText>
                  {step.seqs.length > 1 ? <Figure>×{step.seqs.length}</Figure> : null}
                  <Figure>{offsetLabel(step.at, props.startedAt)}</Figure>
                </Pressable>
                {props.onOpenBrowserLog && step.browser && step.calls[0] ? (
                  <IconButton
                    label="Open in browser log"
                    className={cn(
                      "pointer-events-none opacity-0",
                      "group-hover/step:pointer-events-auto group-hover/step:opacity-100",
                      "focus-visible:pointer-events-auto focus-visible:opacity-100",
                      selected && "pointer-events-auto opacity-100",
                    )}
                    onClick={() => props.onOpenBrowserLog?.(step.calls[0]!)}
                  >
                    <ScrollText aria-hidden="true" />
                  </IconButton>
                ) : null}
              </Text>
            );
          })}
        </ol>
      )}
      {described.hiddenCount > 0 ? (
        <Text
          as="div"
          bare
          size="caption"
          tone="muted"
          className="flex items-center justify-between gap-2 pr-1 pl-2.5"
        >
          <span>
            {described.hiddenCount} behind-the-scenes{" "}
            {described.hiddenCount === 1 ? "step" : "steps"}
          </span>
          <Button
            variant="quiet"
            onClick={() => useShowHiddenSteps.getState().set((value) => !value)}
          >
            {showHidden ? "Hide them" : "Show them"}
          </Button>
        </Text>
      ) : null}
    </div>
  );
}

export function RunStepsEmpty({ children }: { children: ReactNode }) {
  return (
    <Text wrap size="meta" tone="muted" className="px-2.5 py-1.5">
      {children}
    </Text>
  );
}
