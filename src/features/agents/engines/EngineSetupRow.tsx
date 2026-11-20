import { Check } from "lucide-react";
import { useEffect, type KeyboardEvent } from "react";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { ENGINE_NAMES, type EngineId } from "@/features/engine-config/channels";
import { cn, SetupState, Surface, Text } from "@misty/ui";
import { useEngineReadiness } from "./engineReadiness";
import { EngineNextStep } from "./EngineNextStep";

export { engineSetupState, type EngineSetupState } from "./engineReadiness";
import type { EngineSetupState } from "./engineReadiness";

/**
 * How each featured engine is paid for, in the words of someone who has never used one: the free
 * ones say so, the others name the account they use. Nothing here asks anyone to buy anything.
 */
const ACCOUNT_HINTS: Partial<Record<EngineId, string>> = {
  agy: "Free with a Google account",
  opencode: "Free, no account",
  codex: "With a ChatGPT account",
  claude: "With a Claude plan",
};

/**
 * One engine on the setup page: its mark and name, then the single thing to do next. Install runs
 * the same plan as Agents › CLIs (npm in the app, the vendor's installer in a terminal
 * the person watches), and sign-in is the CLI's own login in a terminal.
 */
export function EngineSetupRow({
  engine,
  onState,
  chosen,
  onChoose,
  unfit,
}: {
  engine: EngineId;
  onState(engine: EngineId, state: EngineSetupState): void;
  /** With `onChoose`, a ready engine can be picked, as for a new agent; the pick has a check. */
  chosen?: boolean;
  onChoose?(engine: EngineId): void;
  /** It can't be the default engine (no images, Misty's tools or web search), so isn't picked. */
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
        {hasEngineMark(engine) ? (
          <EngineMark engine={engine} size={18} />
        ) : (
          <span className="text-sm font-semibold">{name.charAt(0)}</span>
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
        // A ready engine that can be picked shows the check only once it is the pick.
        chosen ? (
          <Text bare tone="bright" className="flex shrink-0">
            <Check aria-label={`${name} chosen`} />
          </Text>
        ) : null
      ) : (
        <Text bare tone="bright" className="inline-flex h-8 items-center gap-1.5 px-2 text-sm">
          <Check aria-hidden="true" />
          Ready
        </Text>
      )}
      {/* Always mounted, so an install or sign-in dialog stays open as the state moves on. */}
      <EngineNextStep engine={engine} view={view} state={state} />
    </Surface>
  );
}
