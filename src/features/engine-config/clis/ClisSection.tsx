// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Settings › Engines › CLIs: each engine CLI's version on this computer, the latest one on npm,
 * whether the person is signed in (as the CLI itself says), and installing or updating it.
 *
 * One row per engine: its mark and name, then its sign-in pill with a sign-in button while it is
 * signed out (the CLI's own login, in a terminal), a status pill (checking, not installed, or the
 * version with a check or an arrow), the install or update button naming the target, and the
 * docs and refresh buttons. Versions are checked when the page opens and on refresh, never on a
 * timer.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUp, BookOpen, Check, Download, Globe, LogIn, MapPin, RefreshCw } from "lucide-react";
import { useState } from "react";
import { EngineMark, hasEngineMark } from "../EngineMark";
import { DesktopSettingsSection as Section } from "@/features/settings";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
  Skeleton,
  IconButton,
  OverflowFadeText,
} from "@/shared/ui";
import { ENGINE_DOCS_URLS, ENGINE_IDS, ENGINE_NAMES, type EngineId } from "../channels/engines";
import type { CliVersionStatus } from "./api";
import { CliUpdateDialog } from "./CliUpdateDialog";
import { SignInDialog } from "./SignInDialog";
import { useCliUpdateFlow } from "./useCliUpdateFlow";
import { useCliVersionStatus } from "./useCliVersionStatus";

const pill =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-cream/10 bg-charcoal-hover px-2 text-xs text-cream-muted";

function openDocs(url: string) {
  void openUrl(url).catch(() => {});
}

function VersionPill({ status, error }: { status: CliVersionStatus | null; error: string | null }) {
  if (status === null) {
    return error ? (
      <span className={pill} title={error}>
        Check failed
      </span>
    ) : (
      <Skeleton className="h-6 w-20 rounded-md" />
    );
  }
  if (!status.installed) return <span className={pill}>Not installed</span>;
  if (!status.localVersion) return <span className={pill}>Installed</span>;
  return (
    <span className={pill}>
      {status.updateAvailable ? (
        <ArrowUp className="size-3.5" aria-label="Update available" />
      ) : status.latestVersion ? (
        <Check className="size-3.5" aria-label="Up to date" />
      ) : null}
      v{status.localVersion.replace(/^v/, "")}
    </span>
  );
}

function SignInPill({ signedIn, detail }: { signedIn: boolean | null; detail: string | null }) {
  if (signedIn === null) return null;
  return (
    <span className={pill} title={detail ?? undefined}>
      {signedIn ? "Signed in" : "Signed out"}
    </span>
  );
}

function CliRow({ engine }: { engine: EngineId }) {
  const { status, signIn, loading, error, updating, refresh } = useCliVersionStatus(engine);
  const flow = useCliUpdateFlow(engine);
  const name = ENGINE_NAMES[engine];
  const canAct =
    status !== null && status.updateKind !== null && (!status.installed || status.updateAvailable);
  // The sign-in to start, or null. MiniMax Code asks which region's account first.
  const [signingIn, setSigningIn] = useState<{ provider?: string } | null>(null);
  // Signed out, or a CLI that can't say: its own login is a click away. DeepSeek Harness keeps
  // its providers in its own web page (Channels › DeepSeek Harness).
  const canSignIn =
    status?.installed === true && signIn !== null && signIn.signedIn !== true && engine !== "dsh";
  return (
    <div className="flex min-h-[52px] items-center gap-3 border-b border-charcoal-border px-3 py-2.5 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center text-cream">
        {hasEngineMark(engine) ? (
          <EngineMark engine={engine} size={16} />
        ) : (
          <span className="text-xs font-semibold">{name.charAt(0)}</span>
        )}
      </span>
      <OverflowFadeText as="p" full className="min-w-0 flex-1 text-sm text-cream-bright">
        {ENGINE_NAMES[engine]}
      </OverflowFadeText>
      <SignInPill
        signedIn={status?.installed ? (signIn?.signedIn ?? null) : null}
        detail={signIn?.detail ?? null}
      />
      {canSignIn && engine === "minimax" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={updating}>
              <LogIn />
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
      ) : canSignIn ? (
        <Button disabled={updating} onClick={() => setSigningIn({})}>
          <LogIn />
          Sign in
        </Button>
      ) : null}
      <VersionPill status={status} error={error} />
      {canAct ? (
        <Button variant="primary" disabled={updating || loading} onClick={() => void flow.begin()}>
          {updating ? null : status.installed ? <ArrowUp /> : <Download />}
          {updating
            ? "Updating"
            : status.installed
              ? `Update to ${status.latestVersion ?? "latest"}`
              : "Install"}
        </Button>
      ) : null}
      <IconButton
        size="sm"
        label={`${ENGINE_NAMES[engine]} docs`}
        onClick={() => openDocs(ENGINE_DOCS_URLS[engine])}
      >
        <BookOpen />
      </IconButton>
      <IconButton
        size="sm"
        label={`Check ${ENGINE_NAMES[engine]} again`}
        disabled={loading || updating}
        onClick={refresh}
      >
        <RefreshCw className={cn(loading && "animate-spin")} />
      </IconButton>
      <CliUpdateDialog engine={engine} flow={flow} />
      <SignInDialog
        request={signingIn ? { engine, ...signingIn } : null}
        onClose={() => {
          setSigningIn(null);
          refresh();
        }}
      />
    </div>
  );
}

/** Settings › Engines › CLIs. */
export function ClisSection() {
  return (
    <Section title="CLIs">
      {ENGINE_IDS.map((engine) => (
        <CliRow key={engine} engine={engine} />
      ))}
    </Section>
  );
}
