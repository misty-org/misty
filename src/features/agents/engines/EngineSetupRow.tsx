import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Download, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { ENGINE_DOCS_URLS, ENGINE_NAMES, type EngineId } from "@/features/engine-config/channels";
import {
  CliUpdateDialog,
  SignInButton,
  SignInDialog,
  useCliUpdateFlow,
  useCliVersionStatus,
} from "@/features/engine-config/clis";
import { Button, cn, Skeleton, Surface, Text } from "@/shared/ui";

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

/**
 * Engines that run with no sign-in of Misty's: OpenCode is free with no account, and DeepSeek
 * Harness keeps its providers in its own web page, so installed is as ready as they get.
 */
const needsNoSignIn = (engine: EngineId) => engine === "opencode" || engine === "dsh";

export function engineSetupState(
  engine: EngineId,
  view: Pick<ReturnType<typeof useCliVersionStatus>, "status" | "signIn" | "error">,
): EngineSetupState {
  const { status, signIn, error } = view;
  if (status === null) return error ? "failed" : "checking";
  if (!status.installed) return status.updateKind === null ? "get" : "install";
  // Signed in only when the CLI (or a sign-in Misty watched finish) says so: one that can't say
  // asks for a sign-in rather than failing on the first chat.
  if (signIn?.signedIn !== true && !needsNoSignIn(engine)) return "sign-in";
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
      ) : state === "sign-in" ? (
        <SignInButton engine={engine} label={`Sign in to ${name}`} onSignIn={setSigningIn} />
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
      <CliUpdateDialog engine={engine} flow={flow} plain />
      <SignInDialog
        request={signingIn ? { engine, ...signingIn } : null}
        onClose={() => {
          setSigningIn(null);
          view.refresh();
        }}
      />
    </Surface>
  );
}
