import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Download, ExternalLink, LogIn, RefreshCw } from "lucide-react";
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
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from "@/shared/ui";

/** Where an engine stands for first run: one next step at a time. */
export type EngineSetupState = "checking" | "failed" | "install" | "get" | "sign-in" | "ready";

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
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-charcoal-hover text-cream-bright">
        {hasEngineMark(engine) ? (
          <EngineMark engine={engine} size={18} />
        ) : (
          <span className="text-sm font-semibold">{name.charAt(0)}</span>
        )}
      </span>
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-cream-bright">{name}</p>
      {state === "checking" ? (
        <Skeleton aria-label={`Checking ${name}`} className="h-8 w-[88px] rounded-md" />
      ) : state === "failed" ? (
        <Button size="sm" variant="outline" disabled={view.loading} onClick={view.refresh}>
          <RefreshCw />
          Check again
        </Button>
      ) : state === "install" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={view.updating}
          aria-label={`Install ${name}`}
          onClick={() => void flow.begin()}
        >
          <Download />
          Install
        </Button>
      ) : state === "get" ? (
        <Button
          size="sm"
          variant="outline"
          aria-label={`Get ${name}`}
          onClick={() => void openUrl(ENGINE_DOCS_URLS[engine]).catch(() => {})}
        >
          <ExternalLink />
          Get it
        </Button>
      ) : state === "sign-in" && engine === "minimax" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" aria-label={`Sign in to ${name}`}>
              <LogIn />
              Sign in
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setSigningIn({ provider: "global" })}>
              Global account
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSigningIn({ provider: "cn" })}>
              China account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : state === "sign-in" ? (
        <Button
          size="sm"
          variant="outline"
          aria-label={`Sign in to ${name}`}
          onClick={() => setSigningIn({})}
        >
          <LogIn />
          Sign in
        </Button>
      ) : onChoose ? (
        <span className="inline-flex size-8 items-center justify-center text-cream-bright">
          {chosen ? <Check className="size-4" aria-hidden="true" /> : null}
        </span>
      ) : (
        <span className="inline-flex h-8 items-center gap-1.5 px-2 text-sm text-cream-bright">
          <Check className="size-4" aria-hidden="true" />
          Ready
        </span>
      )}
      <CliUpdateDialog engine={engine} flow={flow} />
      <SignInDialog
        request={signingIn ? { engine, ...signingIn } : null}
        onClose={() => {
          setSigningIn(null);
          view.refresh();
        }}
      />
    </li>
  );
}
