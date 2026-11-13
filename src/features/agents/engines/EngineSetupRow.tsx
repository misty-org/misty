import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Download, ExternalLink, Globe, LogIn, MapPin, RefreshCw } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { ENGINE_DOCS_URLS, ENGINE_NAMES, type EngineId } from "@/features/engine-config/channels";
import {
  CliUpdateDialog,
  SignInDialog,
  useCliUpdateFlow,
  useCliVersionStatus,
} from "@/features/engine-config/clis";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
  Skeleton,
  Text,
} from "@/shared/ui";

/** Where an engine stands for first run: one next step at a time. */
export type EngineSetupState = "checking" | "failed" | "install" | "get" | "sign-in" | "ready";

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

/** DeepSeek Harness keeps its providers in its own web page, so installed is as ready as it gets. */
const signsInElsewhere = (engine: EngineId) => engine === "dsh";

export function engineSetupState(
  engine: EngineId,
  view: Pick<ReturnType<typeof useCliVersionStatus>, "status" | "signIn" | "error">,
): EngineSetupState {
  const { status, signIn, error } = view;
  if (status === null) return error ? "failed" : "checking";
  if (!status.installed) return status.updateKind === null ? "get" : "install";
  // A CLI that can't say whether it is signed in is taken at its word when it runs.
  if (signIn?.signedIn === false && !signsInElsewhere(engine)) return "sign-in";
  return "ready";
}

/**
 * One engine on the setup page: its mark and name, then the single thing to do next. Install runs
 * the same plan as Settings › Engines › CLIs (npm in the app, the vendor's installer in a terminal
 * the person watches), and sign-in is the CLI's own login in a terminal.
 */
export function EngineSetupRow({
  engine,
  onState,
  chosen,
  onChoose,
}: {
  engine: EngineId;
  onState(engine: EngineId, state: EngineSetupState): void;
  /** With `onChoose`, a ready engine can be picked, as for a new agent; the pick has a check. */
  chosen?: boolean;
  onChoose?(engine: EngineId): void;
}) {
  const view = useCliVersionStatus(engine);
  const flow = useCliUpdateFlow(engine);
  const [signingIn, setSigningIn] = useState<{ provider?: string } | null>(null);
  const state = engineSetupState(engine, view);
  const name = ENGINE_NAMES[engine];
  useEffect(() => onState(engine, state), [engine, state, onState]);
  const choosable = Boolean(onChoose) && state === "ready";
  const choose = () => onChoose?.(engine);
  return (
    <li
      className={cn(
        "flex min-h-[60px] items-center gap-3 px-4 py-2.5",
        choosable && "cursor-pointer hover:bg-charcoal-hover focus-visible:bg-charcoal-hover",
        choosable && "outline-none",
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
      <span className="flex size-9 shrink-0 items-center justify-center text-cream-bright">
        {hasEngineMark(engine) ? (
          <EngineMark engine={engine} size={18} />
        ) : (
          <span className="text-sm font-semibold">{name.charAt(0)}</span>
        )}
      </span>
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
        <Skeleton aria-label={`Checking ${name}`} className="h-8 w-22 rounded-md" />
      ) : state === "failed" ? (
        <Button icon={RefreshCw} loading={view.loading} onClick={view.refresh}>
          Check again
        </Button>
      ) : state === "install" ? (
        <Button
          icon={Download}
          loading={view.updating}
          aria-label={`Install ${name}`}
          onClick={() => void flow.begin()}
        >
          Install
        </Button>
      ) : state === "get" ? (
        <Button
          icon={ExternalLink}
          aria-label={`Get ${name}`}
          onClick={() => void openUrl(ENGINE_DOCS_URLS[engine]).catch(() => {})}
        >
          Get it
        </Button>
      ) : state === "sign-in" && engine === "minimax" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button icon={LogIn} aria-label={`Sign in to ${name}`}>
              Sign in
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <MenuItem
              icon={Globe}
              label="Global account"
              onSelect={() => setSigningIn({ provider: "global" })}
            />
            <MenuItem
              icon={MapPin}
              label="China account"
              onSelect={() => setSigningIn({ provider: "cn" })}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : state === "sign-in" ? (
        <Button icon={LogIn} aria-label={`Sign in to ${name}`} onClick={() => setSigningIn({})}>
          Sign in
        </Button>
      ) : onChoose ? (
        // A ready engine that can be picked shows the check only once it is the pick.
        chosen ? (
          <Check className="size-4 shrink-0 text-cream-bright" aria-label={`${name} chosen`} />
        ) : null
      ) : (
        <span className="inline-flex h-8 items-center gap-1.5 px-2 text-sm text-cream-bright">
          <Check className="size-4" aria-hidden="true" />
          Ready
        </span>
      )}
      <CliUpdateDialog engine={engine} flow={flow} plain />
      <SignInDialog
        plain
        request={signingIn ? { engine, ...signingIn } : null}
        onClose={() => {
          setSigningIn(null);
          view.refresh();
        }}
      />
    </li>
  );
}
