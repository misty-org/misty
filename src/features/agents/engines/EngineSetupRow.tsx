import { Check } from "lucide-react";
import { useEffect, type KeyboardEvent } from "react";
import { ENGINE_NAMES, type EngineId } from "@/features/engine-config/channels";
import { cn, hasMark, LogoInitial, Mark, SetupState, Surface, Text } from "@misty/ui";
import { useEngineReadiness } from "./engine_readiness";
import { EngineNextStep } from "./EngineNextStep";

export { engineSetupState, type EngineSetupState } from "./engine_readiness";
import type { EngineSetupState } from "./engine_readiness";

const ACCOUNT_HINTS: Partial<Record<EngineId, string>> = {
  agy: "Free with a Google account",
  opencode: "Free, no account",
  codex: "With a ChatGPT account",
  claude: "With a Claude plan",
};

export function EngineSetupRow({
  engine,
  onState,
  chosen,
  onChoose,
  unfit,
}: {
  engine: EngineId;
  onState(engine: EngineId, state: EngineSetupState): void;
  chosen?: boolean;
  onChoose?(engine: EngineId): void;
  unfit?: boolean;
}) {
  const { view, state } = useEngineReadiness(engine);
  const name = ENGINE_NAMES[engine];
  useEffect(() => onState(engine, state), [engine, state, onState]);
  const choosable = Boolean(onChoose) && state === "ready" && !unfit;
  const choose = () => onChoose?.(engine);
  return (
    <Surface
      as="li"
      tone="none"
      wash={choosable ? "card" : undefined}
      className={cn(
        "flex min-h-15 items-center gap-3 px-4 py-2.5",
        choosable && "cursor-pointer outline-none",
      )}
      {...(choosable
        ? {
            role: "radio",
            "aria-checked": Boolean(chosen),
            tabIndex: 0,
            onClick: choose,
            onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              choose();
            },
          }
        : {})}
    >
      <Text bare tone="bright" className="flex size-9 shrink-0 items-center justify-center">
        {hasMark(`engine:${engine}`) ? (
          <Mark of={`engine:${engine}`} size={18} />
        ) : (
          <LogoInitial name={name} size={18} />
        )}
      </Text>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <Text size="control" weight="medium" tone="bright" full className="min-w-0 shrink">
          {name}
        </Text>
        {ACCOUNT_HINTS[engine] ? (
          <Text size="meta" tone="muted" className="min-w-0 shrink-[2]">
            {ACCOUNT_HINTS[engine]}
          </Text>
        ) : null}
      </span>
      {state === "checking" ? (
        <SetupState
          size="row"
          tool="check"
          label={`Checking ${name}`}
          onRetry={view.refresh}
          className="shrink-0"
        />
      ) : state !== "ready" ? null : onChoose && unfit ? (
        <Text bare size="meta" tone="muted" className="shrink-0">
          Can't run Misty's own work
        </Text>
      ) : onChoose ? (
        chosen ? (
          <Text bare tone="bright" className="flex shrink-0">
            <Check aria-label={`${name} chosen`} />
          </Text>
        ) : null
      ) : (
        <Text
          bare
          size="control"
          tone="bright"
          className="inline-flex h-8 items-center gap-1.5 px-2"
        >
          <Check aria-hidden="true" />
          Ready
        </Text>
      )}
      <EngineNextStep engine={engine} view={view} state={state} />
    </Surface>
  );
}
